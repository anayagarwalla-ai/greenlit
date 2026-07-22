\set ON_ERROR_STOP on
set role service_role;

do $$
declare
  v_owner uuid:=gen_random_uuid(); v_request_key text:=gen_random_uuid()::text;
  v_first jsonb; v_second jsonb; v_record uuid; v_run uuid:=gen_random_uuid(); v_packet uuid:=gen_random_uuid();
  v_invoice_job uuid;
  v_off_owner uuid:=gen_random_uuid(); v_off_record uuid; v_off_run uuid:=gen_random_uuid(); v_off_packet uuid:=gen_random_uuid();
  v_hold_request uuid:=gen_random_uuid(); v_hold_evidence uuid:=gen_random_uuid();
  v_criteria jsonb:='[{"id":"AC-01","title":"Criterion","sourceQuote":"Required source quote","supported":true,"checkType":"element_state"}]'::jsonb;
  v_checks jsonb:='[{"id":"CHK-01","criterionId":"AC-01","type":"element_state","path":"/","sourceQuote":"Required source quote","confirmedByHuman":true,"elementRef":"main:Content","assertion":"visible"}]'::jsonb;
begin
  insert into auth.users(id,email) values(v_owner,'blocker-owner@example.test'),(v_off_owner,'offboard@example.test');
  insert into beta_invites(email,status,adult_sponsor,invited_by) values
    ('blocker-owner@example.test','ACTIVE','Test operator','regression test'),
    ('offboard@example.test','ACTIVE','Test operator','regression test');

  -- One client request key can create at most one retained record/job.
  v_first:=queue_verification_job_idempotent_atomic(null,'MP-IDEMPOTENT',v_owner,'owner-hash','IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1000,'USD','sow.txt','source-hash',v_criteria,'criteria-hash','https://example.test','https://example.test','build-1',v_checks,'0.7.0','{}'::jsonb,'actor','2026-07-20','[]'::jsonb,v_request_key);
  v_second:=queue_verification_job_idempotent_atomic(null,'MP-IGNORED',v_owner,'different-hash','IMPORTED_FIXTURE','Changed','Changed','Changed','Changed',2000,'USD','other.txt','other-source',v_criteria,'other-criteria','https://other.example.test','https://other.example.test','build-2',v_checks,'0.7.0','{}'::jsonb,'actor','2026-07-20','[]'::jsonb,v_request_key);
  assert v_first->>'recordId'=v_second->>'recordId' and v_first->>'jobId'=v_second->>'jobId', 'request-key retry created a duplicate record or job';
  assert (v_second->>'reused')::boolean, 'request-key retry was not reported as reused';

  -- Manual sending must use the newly confirmed plan, never the old review snapshot.
  insert into transaction_records(public_id,owner_token_hash,owner_user_id,mode,agency_name,client_name,project_name,milestone_title,amount_minor,currency,source_name,source_sha256,confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status,last_run_id)
  values('MP-MANUAL-PLAN','manual-owner-hash',v_owner,'IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1250,'USD','sow.txt','source',v_criteria,'criteria','https://example.test',1,'APPROVED',v_run) returning id into v_record;
  insert into verification_jobs_v2(id,record_id,status,target_origin,build_url,build_label,checks,results,artifacts,runner_version,criteria_revision,criteria_sha256,origin_addresses)
  values(v_run,v_record,'COMPLETED','https://example.test','https://example.test','build',v_checks,'[]'::jsonb,'[]'::jsonb,'0.7.0',1,'criteria','[]'::jsonb);
  insert into review_packets_v2(id,record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision,decision,reviewer_name,reviewer_email,decided_at)
  values(v_packet,v_record,v_run,'REVIEW-MANUAL',jsonb_build_object('invoicePlan',jsonb_build_object('enabled',true,'billingEmail','old@example.test','planSha256',repeat('0',64))),repeat('1',64),repeat('2',64),now()+interval '1 day',1,'APPROVED','Reviewer','reviewer@example.test',now());
  perform save_invoice_plan_atomic(v_record,v_owner,null,'New Billing','new@example.test',14,'Updated after approval',false,1250,'USD',1,repeat('a',64),'owner');
  perform queue_approved_invoice_job_atomic(v_packet,v_owner,'owner');
  assert (select plan->>'billingEmail' from invoice_jobs where packet_id=v_packet)='new@example.test', 'manual invoice retained the old snapshot recipient';
  select id into v_invoice_job from invoice_jobs where packet_id=v_packet;
  perform claim_invoice_job_atomic(v_invoice_job,v_owner,now());
  perform fail_invoice_job_atomic(v_invoice_job,'Multiple Stripe customers use this email. Select the correct customer before retrying.',now());
  assert (select failure_code from invoice_jobs where id=v_invoice_job)='CUSTOMER_SELECTION_REQUIRED', 'recoverable customer-selection failure was not classified';
  perform save_invoice_plan_atomic(v_record,v_owner,'cus_correct123','New Billing','new@example.test',14,'Corrected Stripe customer',false,1250,'USD',1,repeat('b',64),'owner');
  perform queue_approved_invoice_job_atomic(v_packet,v_owner,'owner');
  assert (select status from invoice_jobs where id=v_invoice_job)='PENDING', 'corrected Stripe customer could not be requeued';
  assert (select plan->>'stripeCustomerId' from invoice_jobs where id=v_invoice_job)='cus_correct123', 'corrected Stripe customer was not frozen into the retry';
  assert (select plan->>'planSha256' from invoice_jobs where id=v_invoice_job)=repeat('b',64), 'corrected invoice plan hash was not frozen into the retry';
  perform mint_receipt_session_atomic(v_packet,v_owner,repeat('f',64),now()+interval '7 days','owner');
  assert exists(select 1 from receipt_sessions_v2 where packet_id=v_packet and session_hash=repeat('f',64)), 'authorized receipt link was not persisted';

  -- A deletion lease blocks a newly applied hold before bytes are touched.
  insert into privacy_requests_v2(id,public_id,request_type,email,status,identity_verified_at) values(v_hold_request,'PRIV-HOLD-RACE','ACCESS','blocker-owner@example.test','PROCESSING',now());
  insert into evidence_artifacts_v2(id,record_id,run_id,criterion_id,kind,storage_path,mime_type,byte_size,sha256,expires_at,deletion_status,deletion_requested_at)
  values(v_hold_evidence,v_record,v_run,'AC-HOLD-RACE','SCREENSHOT','race.png','image/png',1,'hash',now()-interval '1 day','PENDING',now());
  begin
    perform set_privacy_legal_hold_atomic(v_hold_request,true,'operator@example.test',now());
    raise exception 'BLOCKER CHECK FAILED: legal hold was accepted after evidence deletion staging';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;

  -- Removing an account revokes every undecided external/financial path.
  insert into transaction_records(public_id,owner_token_hash,owner_user_id,mode,agency_name,client_name,project_name,milestone_title,amount_minor,currency,source_name,source_sha256,confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status,last_run_id)
  values('MP-OFFBOARD','offboard-owner-hash',v_off_owner,'IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1500,'USD','sow.txt','source',v_criteria,'criteria','https://example.test',1,'IN_REVIEW',v_off_run) returning id into v_off_record;
  insert into verification_jobs_v2(id,record_id,status,target_origin,build_url,build_label,checks,results,artifacts,runner_version,criteria_revision,criteria_sha256,origin_addresses)
  values(v_off_run,v_off_record,'COMPLETED','https://example.test','https://example.test','build',v_checks,'[]'::jsonb,'[]'::jsonb,'0.7.0',1,'criteria','[]'::jsonb);
  insert into review_packets_v2(id,record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision)
  values(v_off_packet,v_off_record,v_off_run,'REVIEW-OFFBOARD','{}'::jsonb,repeat('3',64),repeat('4',64),now()+interval '1 day',1);
  insert into invoice_jobs(packet_id,record_id,owner_user_id,plan,status,idempotency_prefix) values(v_off_packet,v_off_record,v_off_owner,jsonb_build_object('planSha256',repeat('5',64)),'PENDING','offboard-job');
  insert into stripe_connections(owner_user_id,stripe_account_id,livemode,status,access_token_ciphertext,refresh_token_ciphertext,access_token_expires_at)
  values(v_off_owner,'acct_offboard',false,'CONNECTED','access','refresh',now()+interval '1 hour');
  perform manage_beta_invite_atomic('offboard@example.test','REMOVED','Test operator','operator@example.test',now());
  assert exists(select 1 from review_packets_v2 where id=v_off_packet and revoked_at is not null), 'offboarding did not revoke the review link';
  assert (select status from invoice_jobs where packet_id=v_off_packet)='CANCELLED', 'offboarding did not cancel the invoice job';
  assert (select status from stripe_connections where owner_user_id=v_off_owner)='DISCONNECTED', 'offboarding did not disconnect Stripe';
  begin
    perform record_review_decision_with_notification_atomic(v_off_packet,'APPROVED','Reviewer','reviewer@example.test','','2026-07-20','actor','US',now(),'receipt','IN_APP','session',now()+interval '1 day');
    raise exception 'BLOCKER CHECK FAILED: removed agency accepted a client decision';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;
  begin
    perform queue_verification_job_idempotent_atomic(v_off_record,'MP-OFFBOARD',v_off_owner,'hash','IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1500,'USD','sow.txt','source',v_criteria,'criteria','https://example.test','https://example.test','build',v_checks,'0.7.0','{}'::jsonb,'actor','2026-07-20','[]'::jsonb,gen_random_uuid()::text);
    raise exception 'BLOCKER CHECK FAILED: removed agency queued a new verification';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;
  begin
    perform create_review_packet_atomic(v_off_record,v_off_run,'REVIEW-OFFBOARD-2',jsonb_build_object('recordId',v_off_record::text,'revision',1,'run',jsonb_build_object('runId',v_off_run::text)),repeat('6',64),repeat('7',64),now()+interval '1 day','actor',1);
    raise exception 'BLOCKER CHECK FAILED: removed agency created a review link';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;
  begin
    perform mint_receipt_session_atomic(v_off_packet,v_off_owner,repeat('8',64),now()+interval '1 day','actor');
    raise exception 'BLOCKER CHECK FAILED: removed agency minted a receipt link';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;

  raise notice '=== ALL 2026-07-22 BETA BLOCKER REGRESSIONS PASSED ===';
end;
$$;
