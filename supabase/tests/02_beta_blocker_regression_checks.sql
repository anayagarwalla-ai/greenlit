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
  insert into auth.sessions(user_id) values(v_off_owner);
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
  assert not exists(select 1 from auth.sessions where user_id=v_off_owner), 'offboarding did not revoke refresh sessions';
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

do $$
declare
  v_now timestamptz:=clock_timestamp();
  v_owner uuid:=gen_random_uuid();
  v_account_user uuid:=gen_random_uuid();
  v_account_request uuid:=gen_random_uuid();
  v_account_cleanup uuid;
  v_cleanup_one uuid:=gen_random_uuid();
  v_cleanup_two uuid:=gen_random_uuid();
  v_overdue_request uuid:=gen_random_uuid();
  v_held_request uuid:=gen_random_uuid();
  v_held_record uuid;
  v_active_record uuid;
  v_active_job uuid:=gen_random_uuid();
  v_evidence_record uuid;
  v_evidence_job uuid:=gen_random_uuid();
  v_evidence_id uuid:=gen_random_uuid();
  v_stale_record uuid;
  v_purged integer;
  v_result jsonb;
  v_criteria jsonb:='[{"id":"AC-01","title":"Criterion","sourceQuote":"Source","supported":true,"checkType":"element_state"}]'::jsonb;
  v_checks jsonb:='[{"id":"CHK-01","criterionId":"AC-01","type":"element_state","path":"/","sourceQuote":"Source","confirmedByHuman":true,"elementRef":"main","assertion":"visible"}]'::jsonb;
begin
  insert into auth.users(id,email) values
    (v_owner,'privacy-lifecycle-owner@example.test'),
    (v_account_user,'privacy-account-delete@example.test');

  insert into privacy_requests_v2(
    id,public_id,request_type,email,status,identity_verified_at
  ) values(
    v_account_request,
    'PRIV-ACCOUNT-DELETE-MINIMIZE',
    'DELETION',
    'privacy-account-delete@example.test',
    'PROCESSING',
    v_now
  );
  insert into privacy_account_deletions(
    request_id,auth_user_id,email,requested_at
  ) values(
    v_account_request,
    v_account_user,
    'Privacy-Account-Delete@Example.Test',
    v_now
  ) returning id into v_account_cleanup;
  assert (
    select email='privacy-account-delete@example.test'
      and email_hash=encode(
        extensions.digest(
          convert_to('privacy-account-delete@example.test','UTF8'),
          'sha256'::text
        ),
        'hex'
      )
      and next_attempt_at<=clock_timestamp()
    from privacy_account_deletions
    where id=v_account_cleanup
  ), 'account-deletion queue did not normalize/hash email or become eligible';
  update privacy_account_deletions
    set status='COMPLETED',completed_at=v_now
    where id=v_account_cleanup;
  assert (
    select email is null
      and completed_at=v_now
      and retention_until<=v_now+interval '30 days'
    from privacy_account_deletions
    where id=v_account_cleanup
  ), 'completed account deletion retained plaintext email or an excessive receipt';

  insert into privacy_verification_account_cleanups(
    id,auth_user_id,email_hash,status,disposition,attempts,requested_at,
    cleanup_after,completed_at,retention_until
  ) values
    (
      v_cleanup_one,
      gen_random_uuid(),
      repeat('a',64),
      'COMPLETED',
      'DELETED',
      1,
      v_now-interval '10 days',
      v_now-interval '9 days',
      v_now-interval '8 days',
      v_now-interval '1 day'
    ),
    (
      v_cleanup_two,
      gen_random_uuid(),
      repeat('b',64),
      'COMPLETED',
      'ALREADY_ABSENT',
      1,
      v_now-interval '10 days',
      v_now-interval '9 days',
      v_now-interval '8 days',
      v_now-interval '1 day'
    );
  v_purged:=purge_completed_privacy_verification_cleanups_atomic(v_now,1);
  assert v_purged=1, 'completed verification cleanup purge ignored its bound';
  assert (
    select count(*)=1
    from privacy_verification_account_cleanups
    where id in (v_cleanup_one,v_cleanup_two)
  ), 'bounded verification cleanup purge removed the wrong number of receipts';

  insert into privacy_requests_v2(
    id,public_id,request_type,email,status,retention_until
  ) values(
    v_overdue_request,
    'PRIV-OVERDUE-NONTERMINAL',
    'ACCESS',
    'privacy-overdue@example.test',
    'PROCESSING',
    v_now-interval '1 day'
  );
  insert into privacy_requests_v2(
    id,public_id,request_type,email,status,retention_until
  ) values(
    v_held_request,
    'PRIV-OVERDUE-HELD',
    'ACCESS',
    'privacy-held@example.test',
    'PROCESSING',
    v_now-interval '1 day'
  );
  insert into transaction_records(
    public_id,owner_user_id,mode,agency_name,client_name,project_name,
    milestone_title,amount_minor,currency,source_name,source_sha256,
    confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status,
    retention_until,legal_hold
  ) values(
    'MP-RELEASED-HOLD-FINALIZE',
    v_owner,
    'IMPORTED_FIXTURE',
    'Agency',
    'Client',
    'Project',
    'Milestone',
    1000,
    'USD',
    'sow.txt',
    'source-hold',
    v_criteria,
    'criteria-hold',
    'https://example.test',
    1,
    'READY',
    v_now-interval '1 day',
    true
  ) returning id into v_held_record;
  insert into legal_holds_v2(
    record_id,privacy_request_id,reason,owner_email,active
  ) values(
    v_held_record,
    v_held_request,
    'Regression active hold',
    'operator@example.test',
    true
  );
  v_result:=purge_expired_privacy_requests_atomic(v_now,500);
  assert not exists(
    select 1 from privacy_requests_v2 where id=v_overdue_request
  ), 'overdue nonterminal privacy request was retained solely because of status';
  assert exists(
    select 1 from privacy_requests_v2 where id=v_held_request
  ), 'active legal hold did not suspend privacy-request expiry';
  assert (v_result->>'overdueNonterminalCount')::integer>=1,
    'overdue nonterminal privacy purge was not reported';

  update legal_holds_v2
    set active=false,released_at=v_now,released_by='operator@example.test'
    where record_id=v_held_record;
  update transaction_records
    set legal_hold=false,
      deletion_status='PENDING',
      deletion_requested_at=v_now-interval '20 minutes'
    where id=v_held_record;
  assert finalize_expired_record_deletion(v_held_record),
    'released legal hold prevented atomic record finalization';
  assert not exists(
    select 1 from legal_holds_v2 where record_id=v_held_record
  ), 'released hold PII survived record finalization';
  perform purge_expired_privacy_requests_atomic(v_now,500);
  assert not exists(
    select 1 from privacy_requests_v2 where id=v_held_request
  ), 'privacy request remained after its legal hold was released';

  insert into transaction_records(
    public_id,owner_user_id,mode,agency_name,client_name,project_name,
    milestone_title,amount_minor,currency,source_name,source_sha256,
    confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status,
    retention_until
  ) values(
    'MP-ACTIVE-JOB-RETENTION-GUARD',
    v_owner,
    'IMPORTED_FIXTURE',
    'Agency',
    'Client',
    'Project',
    'Milestone',
    1000,
    'USD',
    'sow.txt',
    'source-active-job',
    v_criteria,
    'criteria-active-job',
    'https://example.test',
    1,
    'VERIFYING',
    v_now-interval '1 day'
  ) returning id into v_active_record;
  insert into verification_jobs_v2(
    id,record_id,status,target_origin,build_url,build_label,checks,
    runner_version,criteria_revision,criteria_sha256,origin_addresses
  ) values(
    v_active_job,
    v_active_record,
    'RUNNING',
    'https://example.test',
    'https://example.test',
    'active-build',
    v_checks,
    '0.7.1',
    1,
    'criteria-active-job',
    '[]'::jsonb
  );
  update transaction_records
    set active_job_id=v_active_job
    where id=v_active_record;
  perform stage_expired_record_deletion(50,v_now);
  assert (
    select deletion_status='ACTIVE'
    from transaction_records
    where id=v_active_record
  ), 'retention staged a record while verification work was active';

  insert into transaction_records(
    public_id,owner_user_id,mode,agency_name,client_name,project_name,
    milestone_title,amount_minor,currency,source_name,source_sha256,
    confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status
  ) values(
    'MP-STALE-EVIDENCE-LEASE',
    v_owner,
    'IMPORTED_FIXTURE',
    'Agency',
    'Client',
    'Project',
    'Milestone',
    1000,
    'USD',
    'sow.txt',
    'source-stale-evidence',
    v_criteria,
    'criteria-stale-evidence',
    'https://example.test',
    1,
    'APPROVED'
  ) returning id into v_evidence_record;
  insert into verification_jobs_v2(
    id,record_id,status,target_origin,build_url,build_label,checks,
    results,artifacts,runner_version,criteria_revision,criteria_sha256,
    origin_addresses
  ) values(
    v_evidence_job,
    v_evidence_record,
    'COMPLETED',
    'https://example.test',
    'https://example.test',
    'completed-build',
    v_checks,
    '[]'::jsonb,
    '[]'::jsonb,
    '0.7.1',
    1,
    'criteria-stale-evidence',
    '[]'::jsonb
  );
  insert into evidence_artifacts_v2(
    id,record_id,run_id,criterion_id,kind,storage_path,mime_type,byte_size,
    sha256,expires_at,deletion_status,deletion_requested_at,deletion_attempts
  ) values(
    v_evidence_id,
    v_evidence_record,
    v_evidence_job,
    'AC-01',
    'SCREENSHOT',
    'stale/evidence.png',
    'image/png',
    100,
    repeat('c',64),
    v_now-interval '1 day',
    'PENDING',
    v_now-interval '20 minutes',
    1
  );
  perform stage_expired_evidence_deletion(500,v_now);
  assert (
    select deletion_status='PENDING'
      and deletion_attempts=2
      and deletion_requested_at=v_now
    from evidence_artifacts_v2
    where id=v_evidence_id
  ), 'stale pending evidence deletion was not reclaimed';
  perform fail_evidence_deletion_atomic(
    array[v_evidence_id],
    v_evidence_record,
    'synthetic retry failure',
    v_now
  );
  assert (
    select deletion_status='FAILED'
      and deletion_next_attempt_at>v_now
    from evidence_artifacts_v2
    where id=v_evidence_id
  ), 'failed evidence deletion did not receive bounded backoff';

  insert into transaction_records(
    public_id,owner_user_id,mode,agency_name,client_name,project_name,
    milestone_title,amount_minor,currency,source_name,source_sha256,
    confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status,
    retention_until,deletion_status,deletion_requested_at,deletion_attempts
  ) values(
    'MP-STALE-RECORD-LEASE',
    v_owner,
    'IMPORTED_FIXTURE',
    'Agency',
    'Client',
    'Project',
    'Milestone',
    1000,
    'USD',
    'sow.txt',
    'source-stale-record',
    v_criteria,
    'criteria-stale-record',
    'https://example.test',
    1,
    'READY',
    v_now-interval '1 day',
    'PENDING',
    v_now-interval '20 minutes',
    1
  ) returning id into v_stale_record;
  perform stage_expired_record_deletion(50,v_now);
  assert (
    select deletion_status='PENDING'
      and deletion_attempts=2
      and deletion_requested_at=v_now
    from transaction_records
    where id=v_stale_record
  ), 'stale pending record deletion was not reclaimed';
  perform fail_record_deletion_atomic(v_stale_record,'synthetic retry failure');
  assert (
    select deletion_status='FAILED'
      and deletion_next_attempt_at>v_now
    from transaction_records
    where id=v_stale_record
  ), 'failed record deletion did not receive bounded backoff';

  raise notice '=== PRIVACY RETENTION AND DELETION RETRY REGRESSIONS PASSED ===';
end;
$$;

do $$
declare
  v_pause jsonb;
  v_resume jsonb;
  v_before bigint;
begin
  select count(*) into v_before
    from operator_action_events
    where target_type='operational_control' and target_id='RUNS';

  v_pause:=set_operational_control_atomic(
    'RUNS',
    true,
    'Runner provider maintenance is in progress.',
    'operator@example.test',
    now()
  );
  assert (v_pause->>'paused')::boolean, 'atomic control update did not return the effective pause';
  assert (
    select paused and reason='Runner provider maintenance is in progress.'
      and updated_by='operator@example.test'
    from operational_controls where feature='RUNS'
  ), 'atomic control update did not persist the pause';
  assert (
    select count(*)=v_before+1
    from operator_action_events
    where target_type='operational_control' and target_id='RUNS'
  ), 'atomic control update did not persist exactly one operator event';

  v_resume:=set_operational_control_atomic(
    'RUNS',
    false,
    '',
    'operator@example.test',
    now()
  );
  assert not (v_resume->>'paused')::boolean, 'atomic control update did not resume the capability';
  assert (
    select not paused and reason='' from operational_controls where feature='RUNS'
  ), 'atomic control resume did not clear the pause reason';
  raise notice '=== ATOMIC OPERATIONAL CONTROL REGRESSIONS PASSED ===';
end;
$$;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_record uuid;
  v_run uuid:=gen_random_uuid();
  v_packet uuid:=gen_random_uuid();
  v_exception_detail text;
  v_criteria jsonb:='[{"id":"AC-01","title":"Criterion","sourceQuote":"Required source quote","supported":true,"checkType":"element_state"}]'::jsonb;
  v_checks jsonb:='[{"id":"CHK-01","criterionId":"AC-01","type":"element_state","path":"/","sourceQuote":"Required source quote","confirmedByHuman":true,"elementRef":"main:Content","assertion":"visible"}]'::jsonb;
begin
  insert into auth.users(id,email) values(v_owner,'pause-race-owner@example.test');
  insert into transaction_records(
    public_id,owner_token_hash,owner_user_id,mode,agency_name,client_name,
    project_name,milestone_title,amount_minor,currency,source_name,source_sha256,
    confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status
  ) values(
    'MP-PAUSE-RACE','pause-race-hash',v_owner,'IMPORTED_FIXTURE','Agency','Client',
    'Project','Milestone',1000,'USD','sow.txt','source',v_criteria,'criteria',
    'https://example.test',1,'READY'
  ) returning id into v_record;

  perform set_operational_control_atomic('RUNS',true,'Testing the atomic run pause guard.','operator@example.test',now());
  begin
    insert into verification_jobs_v2(
      id,record_id,status,target_origin,build_url,build_label,checks,results,
      artifacts,runner_version,criteria_revision,criteria_sha256,origin_addresses
    ) values(
      v_run,v_record,'COMPLETED','https://example.test','https://example.test',
      'build',v_checks,'[]'::jsonb,'[]'::jsonb,'0.9.0',1,'criteria','[]'::jsonb
    );
    raise exception 'BLOCKER CHECK FAILED: run inserted while RUNS was paused';
  exception when others then
    get stacked diagnostics v_exception_detail=pg_exception_detail;
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
    if sqlerrm not like '%RUNS%paused%' then raise; end if;
    if v_exception_detail<>'RUNS_PAUSED' then raise exception 'RUNS insert guard did not expose its stable pause detail'; end if;
  end;
  assert not exists(select 1 from verification_jobs_v2 where id=v_run), 'paused run insert partially committed';
  perform set_operational_control_atomic('RUNS',false,'','operator@example.test',now());
  insert into verification_jobs_v2(
    id,record_id,status,target_origin,build_url,build_label,checks,results,
    artifacts,runner_version,criteria_revision,criteria_sha256,origin_addresses
  ) values(
    v_run,v_record,'QUEUED','https://example.test','https://example.test',
    'build',v_checks,'[]'::jsonb,'[]'::jsonb,'0.9.0',1,'criteria','[]'::jsonb
  );
  perform set_operational_control_atomic('RUNS',true,'Testing the atomic run lease pause guard.','operator@example.test',now());
  begin
    update verification_jobs_v2 set status='LEASED' where id=v_run;
    raise exception 'BLOCKER CHECK FAILED: queued run leased while RUNS was paused';
  exception when others then
    get stacked diagnostics v_exception_detail=pg_exception_detail;
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
    if sqlerrm not like '%RUNS%paused%' then raise; end if;
    if v_exception_detail<>'RUNS_PAUSED' then raise exception 'RUNS lease guard did not expose its stable pause detail'; end if;
  end;
  assert (select status='QUEUED' from verification_jobs_v2 where id=v_run), 'paused run lease partially committed';
  perform set_operational_control_atomic('RUNS',false,'','operator@example.test',now());
  update verification_jobs_v2 set status='COMPLETED' where id=v_run;

  perform set_operational_control_atomic('REVIEWS',true,'Testing the atomic review pause guard.','operator@example.test',now());
  begin
    insert into review_packets_v2(
      id,record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,
      expires_at,criteria_revision
    ) values(
      v_packet,v_record,v_run,'REVIEW-PAUSE-RACE','{}'::jsonb,repeat('a',64),
      repeat('b',64),now()+interval '1 day',1
    );
    raise exception 'BLOCKER CHECK FAILED: review inserted while REVIEWS was paused';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
    if sqlerrm not like '%REVIEWS%paused%' then raise; end if;
  end;
  assert not exists(select 1 from review_packets_v2 where id=v_packet), 'paused review insert partially committed';
  perform set_operational_control_atomic('REVIEWS',false,'','operator@example.test',now());
  insert into review_packets_v2(
    id,record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,
    expires_at,criteria_revision
  ) values(
    v_packet,v_record,v_run,'REVIEW-PAUSE-RACE','{}'::jsonb,repeat('a',64),
    repeat('b',64),now()+interval '1 day',1
  );
  perform set_operational_control_atomic('REVIEWS',true,'Testing the atomic decision pause guard.','operator@example.test',now());
  begin
    update review_packets_v2 set decision='APPROVED' where id=v_packet;
    raise exception 'BLOCKER CHECK FAILED: decision committed while REVIEWS was paused';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
    if sqlerrm not like '%REVIEWS%paused%' then raise; end if;
  end;
  assert (select decision is null from review_packets_v2 where id=v_packet), 'paused decision partially committed';
  perform set_operational_control_atomic('REVIEWS',false,'','operator@example.test',now());

  perform set_operational_control_atomic('INVOICES',true,'Testing the atomic invoice pause guard.','operator@example.test',now());
  begin
    insert into invoice_jobs(
      packet_id,record_id,owner_user_id,plan,status,idempotency_prefix
    ) values(
      v_packet,v_record,v_owner,jsonb_build_object('planSha256',repeat('c',64)),
      'PENDING','pause-race-invoice'
    );
    raise exception 'BLOCKER CHECK FAILED: invoice inserted while INVOICES was paused';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
    if sqlerrm not like '%INVOICES%paused%' then raise; end if;
  end;
  assert not exists(select 1 from invoice_jobs where packet_id=v_packet), 'paused invoice insert partially committed';
  perform set_operational_control_atomic('INVOICES',false,'','operator@example.test',now());
  insert into invoice_jobs(
    packet_id,record_id,owner_user_id,plan,status,idempotency_prefix
  ) values(
    v_packet,v_record,v_owner,jsonb_build_object('planSha256',repeat('c',64)),
    'PENDING','pause-race-invoice'
  );
  perform set_operational_control_atomic('INVOICES',true,'Testing the atomic invoice claim guard.','operator@example.test',now());
  begin
    update invoice_jobs set status='PROCESSING' where packet_id=v_packet;
    raise exception 'BLOCKER CHECK FAILED: invoice processing started while INVOICES was paused';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
    if sqlerrm not like '%INVOICES%paused%' then raise; end if;
  end;
  assert (select status='PENDING' from invoice_jobs where packet_id=v_packet), 'paused invoice claim partially committed';
  perform set_operational_control_atomic('INVOICES',false,'','operator@example.test',now());

  assert exists(
    select 1 from app_schema_versions where version='202607260004'
  ), 'operational trigger-guard schema version was not recorded';
  raise notice '=== TRANSACTION-LEVEL OPERATIONAL GUARD REGRESSIONS PASSED ===';
end;
$$;

do $$
declare
  v_temp_user uuid:=gen_random_uuid();
  v_real_user uuid:=gen_random_uuid();
  v_temp_request uuid:=gen_random_uuid();
  v_real_request uuid:=gen_random_uuid();
  v_cleanup_id uuid;
  v_scheduled_at timestamptz:=now()+interval '30 minutes';
  v_result jsonb;
begin
  assert to_regprocedure(
    'public.complete_privacy_email_verification_atomic(text,text,text,uuid,timestamptz)'
  ) is null, 'obsolete five-argument privacy verification RPC still exists';
  assert not exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='privacy_verification_account_cleanups'
      and column_name='email'
  ), 'verification cleanup still retains a plaintext email column';
  assert exists(
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='privacy_verification_account_cleanups'
      and column_name in ('email_hash','cleanup_after')
    group by table_name
    having count(*)=2
  ), 'verification cleanup minimization or expiry columns are missing';

  insert into auth.users(id,email) values
    (v_temp_user,'privacy-verification-temp@example.test'),
    (v_real_user,'privacy-verification-real@example.test');
  insert into beta_invites(email,status,adult_sponsor,invited_by)
  values('privacy-verification-real@example.test','ACTIVE','Test operator','regression test');
  insert into privacy_requests_v2(
    id,public_id,request_type,email,status,verification_token_hash,verification_expires_at
  ) values
    (v_temp_request,'PRIV-VERIFICATION-TEMP','ACCESS','privacy-verification-temp@example.test','RECEIVED','temp-token-hash',now()+interval '30 minutes'),
    (v_real_request,'PRIV-VERIFICATION-REAL','ACCESS','privacy-verification-real@example.test','RECEIVED','real-token-hash',now()+interval '30 minutes');

  v_result:=queue_privacy_verification_account_cleanup_atomic(
    v_temp_request,
    v_temp_user,
    'privacy-verification-temp@example.test',
    v_scheduled_at,
    now()
  );
  v_cleanup_id:=(v_result->>'cleanupId')::uuid;
  assert (
    select status='PENDING'
      and cleanup_after between v_scheduled_at-interval '1 second'
        and v_scheduled_at+interval '1 second'
      and email_hash=encode(
        extensions.digest(
          convert_to('privacy-verification-temp@example.test','UTF8'),
          'sha256'::text
        ),
        'hex'
      )
    from privacy_verification_account_cleanups
    where id=v_cleanup_id
  ), 'unclicked verification account was not durably queued until link expiry';

  v_result:=complete_privacy_email_verification_atomic(
    'PRIV-VERIFICATION-TEMP',
    'temp-token-hash',
    'privacy-verification-temp@example.test',
    v_temp_user,
    now(),
    true
  );
  assert (v_result->>'requestId')::uuid=v_temp_request, 'privacy verification returned the wrong request';
  assert (v_result->>'cleanupId') is not null, 'temporary privacy Auth verification did not durably queue cleanup';
  assert (
    select status='VERIFYING' and identity_verified_at is not null
      and verification_token_hash is null
    from privacy_requests_v2 where id=v_temp_request
  ), 'privacy verification was not committed with token erasure';
  assert exists(
    select 1 from privacy_verification_account_cleanups
    where request_id=v_temp_request
      and auth_user_id=v_temp_user
      and status='PENDING'
      and cleanup_after<=now()+interval '1 second'
  ), 'temporary privacy Auth cleanup row is missing';
  assert (v_result->>'cleanupId')::uuid=v_cleanup_id,
    'verification completion duplicated the pre-queued cleanup row';
  assert not exists(
    select 1 from beta_invites where email='privacy-verification-temp@example.test'
  ), 'temporary Auth cleanup incorrectly created a beta deletion tombstone';

  v_result:=complete_privacy_email_verification_atomic(
    'PRIV-VERIFICATION-REAL',
    'real-token-hash',
    'privacy-verification-real@example.test',
    v_real_user,
    now(),
    false
  );
  assert (v_result->>'cleanupId') is null, 'an existing account was incorrectly queued for verification cleanup';
  assert not exists(
    select 1 from privacy_verification_account_cleanups where auth_user_id=v_real_user
  ), 'existing account received a temporary verification cleanup row';
  assert exists(
    select 1 from app_schema_versions where version='202607260003'
  ), 'privacy verification cleanup schema version was not recorded';
  assert exists(
    select 1 from app_schema_versions where version='202607260005'
  ), 'privacy verification lifecycle schema version was not recorded';
  raise notice '=== PRIVACY VERIFICATION ACCOUNT CLEANUP REGRESSIONS PASSED ===';
end;
$$;

do $$
declare
  v_created jsonb;
  v_updated jsonb;
  v_privacy_result jsonb;
  v_request_id uuid;
  v_notification_id uuid;
  v_privacy_request_id uuid:=gen_random_uuid();
  v_privacy_auth_user_id uuid:=gen_random_uuid();
  v_deleted integer;
begin
  assert exists(
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='demo_requests'
      and column_name='retention_until' and is_nullable='NO'
  ), 'demo-request retention timestamp is missing or nullable';
  assert exists(
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='demo_requests'
      and column_name='privacy_notice_version' and is_nullable='NO'
  ), 'demo-request notice evidence is missing or nullable';
  assert exists(
    select 1
    from app_schema_versions
    where version='202607260002'
  ), 'demo-request privacy lifecycle schema version was not recorded';
  assert not has_table_privilege('anon','public.demo_requests','SELECT'), 'anonymous role can read demo requests';
  assert not has_table_privilege('authenticated','public.demo_requests','SELECT'), 'authenticated role can read demo requests';

  v_created:=create_demo_request_atomic(
    'DR-LIFECYCLE-1',
    'Lifecycle Requester',
    'lifecycle-requester@example.test',
    'Lifecycle Agency',
    'Owner',
    '2-10',
    'Calgary, Canada',
    '3-5',
    7,
    'public-https',
    'discovery-call',
    'Approvals happen by email and usually wait for a final client reply.',
    '/request-demo',
    'actor-lifecycle',
    '2026-07-20',
    true,
    true,
    now(),
    'IN_APP'
  );
  v_request_id:=(v_created->>'id')::uuid;
  v_notification_id:=(v_created->>'notificationId')::uuid;
  assert (select contact_consent and adult_business_use_attested from demo_requests where id=v_request_id), 'demo-request consent evidence was not retained';
  assert (select privacy_notice_version='2026-07-20' from demo_requests where id=v_request_id), 'demo-request notice version was not retained';
  assert (select retention_until between created_at+interval '12 months'-interval '1 second' and created_at+interval '12 months'+interval '1 second' from demo_requests where id=v_request_id), 'demo-request retention is not twelve months';
  assert (
    select event_type='DEMO_REQUEST_RECEIVED'
      and title='New company-demo request'
      and body='A new company-demo request is ready for operator qualification.'
      and payload=jsonb_build_object('requestId','DR-LIFECYCLE-1')
    from operator_notifications where id=v_notification_id
  ), 'demo-request operator notification is missing or contains unexpected data';
  assert not exists(
    select 1 from operator_notifications
    where id=v_notification_id
      and lower(title||' '||body||' '||payload::text) like '%lifecycle-requester%'
  ), 'demo-request operator notification exposed requester PII';

  v_updated:=update_demo_request_atomic(
    v_request_id,
    'QUALIFYING',
    'operator@example.test',
    'Follow up after qualification review.',
    'operator@example.test',
    now()
  );
  assert v_updated->>'status'='QUALIFYING', 'atomic demo-request update did not return the new status';
  assert exists(
    select 1 from operator_action_events
    where action_type='UPDATE_DEMO_REQUEST'
      and target_type='demo_request'
      and target_id=v_request_id::text
      and details->>'previousStatus'='NEW'
      and details->>'status'='QUALIFYING'
  ), 'demo-request status update was not operator-audited';

  v_deleted:=purge_expired_demo_requests_atomic(now()+interval '13 months',50);
  assert v_deleted=1, 'expired demo-request purge did not report one deleted request';
  assert not exists(select 1 from demo_requests where id=v_request_id), 'expired demo request was not deleted';

  v_created:=create_demo_request_atomic(
    'DR-PRIVACY-PURGE-1',
    'Privacy Requester',
    'demo-privacy@example.test',
    'Privacy Agency',
    'Operations lead',
    '11-25',
    'Edmonton, Canada',
    '6-10',
    10,
    'password-protected',
    'design-partner',
    'The delivery team records approvals in email before manually starting billing.',
    '/request-demo',
    'actor-privacy-purge',
    '2026-07-20',
    true,
    true,
    now(),
    'IN_APP'
  );
  insert into auth.users(id,email)
  values(v_privacy_auth_user_id,'demo-privacy@example.test');
  insert into privacy_requests_v2(id,public_id,request_type,email,status,identity_verified_at)
  values(v_privacy_request_id,'PRIV-DEMO-PURGE','DELETION','demo-privacy@example.test','VERIFYING',now());
  perform queue_privacy_verification_account_cleanup_atomic(
    v_privacy_request_id,
    v_privacy_auth_user_id,
    'demo-privacy@example.test',
    now()+interval '30 minutes',
    now()
  );
  v_privacy_result:=schedule_privacy_deletion_with_demo_atomic(v_privacy_request_id,'operator@example.test',now());
  assert (v_privacy_result->>'demoRequestCount')::integer=1, 'verified privacy deletion did not report the demo-request purge';
  assert v_privacy_result#>>'{verificationCleanup,disposition}'='PENDING',
    'verified privacy deletion did not preserve the pending Auth cleanup guarantee';
  assert exists(
    select 1 from privacy_verification_account_cleanups
    where auth_user_id=v_privacy_auth_user_id
      and status='PENDING'
      and cleanup_after<=now()+interval '1 second'
  ), 'privacy deletion orphaned or failed to expedite pending Auth cleanup';
  assert not exists(select 1 from demo_requests where email='demo-privacy@example.test'), 'verified privacy deletion retained demo-request PII';
  assert exists(
    select 1 from operator_action_events
    where action_type='PURGE_DEMO_REQUEST_SUBJECT'
      and target_id=v_privacy_request_id::text
      and (details->>'deletedDemoRequests')::integer=1
  ), 'verified demo-request privacy purge was not operator-audited';

  begin
    perform create_demo_request_atomic(
      'DR-NO-CONSENT',
      'No Consent',
      'no-consent@example.test',
      'No Consent Agency',
      'Owner',
      '1',
      'Calgary, Canada',
      '1-2',
      1,
      'other',
      'discovery-call',
      'This request must not be retained because affirmative consent is absent.',
      '/request-demo',
      'actor-no-consent',
      '2026-07-20',
      false,
      true,
      now(),
      'IN_APP'
    );
    raise exception 'BLOCKER CHECK FAILED: demo request was created without consent';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
  end;
  assert not exists(select 1 from demo_requests where public_id='DR-NO-CONSENT'), 'consent failure partially created a demo request';

  raise notice '=== DEMO REQUEST PRIVACY LIFECYCLE REGRESSIONS PASSED ===';
end;
$$;

do $$
begin
  assert to_regclass('public.demo_requests') is not null, 'demo request queue was not migrated';
  assert to_regclass('public.operational_controls') is not null, 'operator controls were not migrated';
  assert (select relrowsecurity from pg_class where oid='public.demo_requests'::regclass), 'demo request queue RLS is disabled';
  assert (select relrowsecurity from pg_class where oid='public.operational_controls'::regclass), 'operator controls RLS is disabled';
  assert (select count(*) from operational_controls)=3, 'operator controls were not seeded exactly once';
  assert not exists(
    select 1 from operational_controls
    where feature not in ('RUNS','REVIEWS','INVOICES') or paused
  ), 'operator controls were seeded in an unsafe or unknown state';
  assert exists(
    select 1 from app_schema_versions where version='202607250001'
  ), 'demo-readiness schema version was not recorded';
  raise notice '=== DEMO INTAKE AND OPERATOR CONTROL REGRESSIONS PASSED ===';
end;
$$;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_privacy_owner uuid:=gen_random_uuid();
  v_legacy_owner uuid:=gen_random_uuid();
  v_record uuid;
  v_job uuid;
  v_packet uuid:=gen_random_uuid();
  v_request uuid:=gen_random_uuid();
  v_legacy_request uuid:=gen_random_uuid();
  v_first jsonb;
  v_second jsonb;
  v_old_scope text;
  v_criteria jsonb:='[{"id":"AC-01","title":"Criterion","sourceQuote":"Required source quote","supported":true,"checkType":"element_state"}]'::jsonb;
  v_checks jsonb:='[{"id":"CHK-01","criterionId":"AC-01","type":"element_state","path":"/","sourceQuote":"Required source quote","confirmedByHuman":true,"elementRef":"main:Content","assertion":"visible"}]'::jsonb;
begin
  insert into auth.users(id,email) values
    (v_owner,'revision-owner@example.test'),
    (v_privacy_owner,'privacy-rollout-owner@example.test'),
    (v_legacy_owner,'legacy-allowlist-owner@example.test');
  insert into auth.sessions(user_id) values(v_privacy_owner),(v_legacy_owner);
  insert into beta_invites(email,status,adult_sponsor,invited_by) values
    ('revision-owner@example.test','ACTIVE','Test operator','regression test'),
    ('privacy-rollout-owner@example.test','ACTIVE','Test operator','regression test');

  -- Changing value/target/check scope is a new frozen milestone revision even
  -- when the source and criteria hashes do not change.
  v_first:=queue_verification_job_idempotent_atomic(
    null,'MP-MATERIAL-REVISION',v_owner,'revision-owner-hash','IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1000,'USD',
    'sow.txt','source-hash',v_criteria,'criteria-hash','https://example.test','https://example.test','build-1',v_checks,
    '0.7.1','{}'::jsonb,'actor','2026-07-20','[]'::jsonb,gen_random_uuid()::text
  );
  v_record:=(v_first->>'recordId')::uuid;
  v_job:=(v_first->>'jobId')::uuid;
  select scope_sha256 into v_old_scope from transaction_records where id=v_record;
  update verification_jobs_v2 set status='FAILED',last_error='test reset',completed_at=now() where id=v_job;
  update transaction_records set status='READY',active_job_id=null where id=v_record;
  v_second:=queue_verification_job_idempotent_atomic(
    v_record,'MP-MATERIAL-REVISION',v_owner,'revision-owner-hash','IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1250,'USD',
    'sow.txt','source-hash',v_criteria,'criteria-hash','https://example.test','https://example.test','build-2',v_checks,
    '0.7.1','{}'::jsonb,'actor','2026-07-20','[]'::jsonb,gen_random_uuid()::text
  );
  assert (v_second->>'criteriaRevision')::integer=2, 'material milestone change did not increment revision';
  assert (select scope_sha256<>v_old_scope from transaction_records where id=v_record), 'material milestone scope hash did not change';
  assert exists(
    select 1 from transaction_audit_events where record_id=v_record and event_type='MILESTONE_REVISED'
      and payload#>>'{previousScope,amountMinor}'='1000' and payload#>>'{newScope,amountMinor}'='1250'
  ), 'revision event did not retain the exact prior and new milestone value';

  -- Privacy deletion must fail closed while Stripe is processing, then revoke
  -- all undecided owner access once the job is safely terminal.
  v_job:=gen_random_uuid();
  insert into transaction_records(public_id,owner_token_hash,owner_user_id,mode,agency_name,client_name,project_name,milestone_title,amount_minor,currency,source_name,source_sha256,confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status,last_run_id)
  values('MP-PRIVACY-OFFBOARD','privacy-owner-hash',v_privacy_owner,'IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1500,'USD','sow.txt','source',v_criteria,'criteria','https://example.test',1,'APPROVED',v_job)
  returning id into v_record;
  insert into verification_jobs_v2(id,record_id,status,target_origin,build_url,build_label,checks,results,artifacts,runner_version,criteria_revision,criteria_sha256,origin_addresses)
  values(v_job,v_record,'COMPLETED','https://example.test','https://example.test','build',v_checks,'[]'::jsonb,'[]'::jsonb,'0.7.1',1,'criteria','[]'::jsonb);
  insert into review_packets_v2(id,record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision)
  values(v_packet,v_record,v_job,'REVIEW-PRIVACY-OFFBOARD','{}'::jsonb,repeat('9',64),repeat('a',64),now()+interval '1 day',1);
  insert into invoice_jobs(packet_id,record_id,owner_user_id,plan,status,idempotency_prefix)
  values(v_packet,v_record,v_privacy_owner,jsonb_build_object('planSha256',repeat('b',64)),'PROCESSING','privacy-processing-job');
  insert into privacy_requests_v2(id,public_id,request_type,email,status,identity_verified_at)
  values(v_request,'PRIV-OFFBOARD','DELETION','privacy-rollout-owner@example.test','PROCESSING',now());
  assert exists(select 1 from auth.users where id=v_privacy_owner and email='privacy-rollout-owner@example.test'), 'privacy owner fixture was not created';
  assert exists(select 1 from invoice_jobs where owner_user_id=v_privacy_owner and status='PROCESSING'), 'processing invoice fixture was not created';
  begin
    perform schedule_privacy_deletion_atomic(v_request,'operator@example.test',now());
    raise exception 'BLOCKER CHECK FAILED: privacy deletion raced a processing invoice';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;
  assert (select status from beta_invites where email='privacy-rollout-owner@example.test')='ACTIVE', 'failed privacy deletion partially removed the invitation';
  assert (select revoked_at is null from review_packets_v2 where id=v_packet), 'failed privacy deletion partially revoked review access';
  assert exists(select 1 from auth.sessions where user_id=v_privacy_owner), 'failed privacy deletion partially revoked the Auth session';

  update invoice_jobs set status='FAILED',claimed_at=null where packet_id=v_packet;
  perform schedule_privacy_deletion_atomic(v_request,'operator@example.test',now());
  assert (select status from beta_invites where email='privacy-rollout-owner@example.test')='REMOVED', 'privacy deletion did not remove beta access';
  assert (select revoked_at is not null from review_packets_v2 where id=v_packet), 'privacy deletion did not revoke undecided review access';
  assert (select status from invoice_jobs where packet_id=v_packet)='CANCELLED', 'privacy deletion did not cancel a failed invoice job';
  assert not exists(select 1 from auth.sessions where user_id=v_privacy_owner), 'privacy deletion did not revoke refresh sessions';

  -- Even if an obsolete worker retained a remote response, completion cannot
  -- commit after the account's durable invitation has been removed.
  update invoice_jobs set status='PROCESSING' where packet_id=v_packet;
  insert into record_invoices(packet_id,record_id,owner_user_id,stripe_account_id,stripe_customer_id,stripe_invoice_id,status,amount_due_minor,amount_paid_minor,currency,billing_email)
  values(v_packet,v_record,v_privacy_owner,'acct_privacy','cus_privacy','in_privacy','DRAFT',1500,0,'USD','client@example.test');
  begin
    perform record_invoice_sent_atomic((select id from invoice_jobs where packet_id=v_packet),'INV-1',1500,0,'USD',now()+interval '14 days','https://stripe.example/invoice','https://stripe.example/pdf',now());
    raise exception 'BLOCKER CHECK FAILED: removed owner completed an invoice';
  exception when others then if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if; end;
  assert (select status from record_invoices where packet_id=v_packet)='DRAFT', 'blocked invoice completion mutated the retained invoice';

  -- A legacy environment-allowlisted account without an invite row receives
  -- a REMOVED tombstone, so config fallback cannot restore its access.
  insert into privacy_requests_v2(id,public_id,request_type,email,status,identity_verified_at)
  values(v_legacy_request,'PRIV-LEGACY-OFFBOARD','DELETION','legacy-allowlist-owner@example.test','PROCESSING',now());
  perform schedule_privacy_deletion_atomic(v_legacy_request,'operator@example.test',now());
  assert (select status from beta_invites where email='legacy-allowlist-owner@example.test')='REMOVED', 'privacy deletion did not tombstone legacy allowlist access';
  assert not exists(select 1 from auth.sessions where user_id=v_legacy_owner), 'legacy allowlist privacy deletion did not revoke refresh sessions';

  raise notice '=== ALL 2026-07-22 ROLLOUT SAFETY REGRESSIONS PASSED ===';
end;
$$;
