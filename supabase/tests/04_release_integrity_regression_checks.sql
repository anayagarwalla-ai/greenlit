\set ON_ERROR_STOP on
set role service_role;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_record uuid;
  v_job uuid:=gen_random_uuid();
  v_lease uuid:=gen_random_uuid();
  v_result text;
  v_checks jsonb:='[{"id":"CHK-01","criterionId":"AC-01","type":"element_state","path":"/","sourceQuote":"Required source quote","confirmedByHuman":true,"elementRef":"main:Content","assertion":"visible"}]'::jsonb;
begin
  insert into auth.users(id,email)
  values(v_owner,'atomic-evidence-owner@example.test');
  insert into transaction_records(
    public_id,owner_token_hash,owner_user_id,mode,agency_name,client_name,
    project_name,milestone_title,amount_minor,currency,source_name,source_sha256,
    confirmed_criteria,criteria_sha256,target_origin,criteria_revision,status
  ) values(
    'MP-ATOMIC-EVIDENCE','atomic-evidence-owner-hash',v_owner,
    'IMPORTED_FIXTURE','Agency','Client','Project','Milestone',1000,'USD',
    'sow.txt','source-hash',
    '[{"id":"AC-01","title":"Criterion","sourceQuote":"Required source quote","supported":true,"checkType":"element_state"}]'::jsonb,
    'criteria-hash','https://example.test',1,'VERIFYING'
  ) returning id into v_record;
  insert into verification_jobs_v2(
    id,record_id,status,attempt,lease_id,target_origin,build_url,build_label,
    checks,results,artifacts,runner_version,criteria_revision,criteria_sha256,
    origin_addresses,started_at
  ) values(
    v_job,v_record,'RUNNING',1,v_lease,'https://example.test',
    'https://example.test','build',v_checks,'[]'::jsonb,'[]'::jsonb,'0.9.0',
    1,'criteria-hash','["203.0.113.10"]'::jsonb,now()
  );
  update transaction_records set active_job_id=v_job where id=v_record;

  v_result:=record_evidence_artifact_atomic(
    v_job,v_lease,'AC-01','SCREENSHOT',
    v_record::text||'/'||v_job::text||'/ac-01-'||repeat('a',64)||'.png',
    'image/png',10,repeat('a',64),now()+interval '90 days'
  );
  assert v_result='RECORDED', 'active lease did not record immutable evidence';
  v_result:=record_evidence_artifact_atomic(
    v_job,v_lease,'AC-01','SCREENSHOT',
    v_record::text||'/'||v_job::text||'/ac-01-'||repeat('a',64)||'.png',
    'image/png',10,repeat('a',64),now()+interval '90 days'
  );
  assert v_result='DUPLICATE', 'exact evidence retry was not idempotent';

  begin
    perform record_evidence_artifact_atomic(
      v_job,v_lease,'AC-01','SCREENSHOT',
      v_record::text||'/'||v_job::text||'/ac-01-'||repeat('b',64)||'.png',
      'image/png',10,repeat('b',64),now()+interval '90 days'
    );
    raise exception 'BLOCKER CHECK FAILED: evidence slot was overwritten';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
  end;
  assert (
    select sha256=repeat('a',64)
      and storage_path like '%'||repeat('a',64)||'.png'
    from evidence_artifacts_v2
    where run_id=v_job and criterion_id='AC-01' and kind='SCREENSHOT'
  ), 'conflicting evidence retry mutated frozen metadata';

  update verification_jobs_v2 set status='COMPLETED' where id=v_job;
  begin
    perform record_evidence_artifact_atomic(
      v_job,v_lease,'AC-01','NETWORK',
      v_record::text||'/'||v_job::text||'/late-'||repeat('c',64)||'.json',
      'application/json',10,repeat('c',64),now()+interval '90 days'
    );
    raise exception 'BLOCKER CHECK FAILED: completed job accepted late evidence';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
  end;
  assert not exists(
    select 1 from evidence_artifacts_v2
    where run_id=v_job and kind='NETWORK'
  ), 'late evidence metadata partially committed';

  raise notice '=== ATOMIC IMMUTABLE EVIDENCE REGRESSIONS PASSED ===';
end;
$$;

do $$
begin
  insert into stripe_webhook_events(
    event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,
    status,error
  ) values(
    'evt_failed_retry','acct_retry','invoice.updated','in_retry',false,
    repeat('d',64),'FAILED','temporary provider failure'
  );
  insert into stripe_webhook_events(
    event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,
    status,processed_at
  ) values(
    'evt_failed_retry','acct_retry','invoice.updated','in_retry',false,
    repeat('d',64),'PROCESSED',now()
  );
  assert (
    select status='PROCESSED' and error is null
    from stripe_webhook_events where event_id='evt_failed_retry'
  ), 'exact signed Stripe retry did not reclaim its failed receipt';

  insert into stripe_webhook_events(
    event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,
    status,error
  ) values(
    'evt_failed_mismatch','acct_retry','invoice.updated','in_retry',false,
    repeat('e',64),'FAILED','temporary provider failure'
  );
  begin
    insert into stripe_webhook_events(
      event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,
      status,processed_at
    ) values(
      'evt_failed_mismatch','acct_retry','invoice.updated','in_retry',false,
      repeat('f',64),'PROCESSED',now()
    );
    raise exception 'BLOCKER CHECK FAILED: mismatched Stripe retry replaced a failed receipt';
  exception when others then
    if sqlerrm like 'BLOCKER CHECK FAILED%' then raise; end if;
  end;
  assert (
    select status='FAILED' and payload_sha256=repeat('e',64)
    from stripe_webhook_events where event_id='evt_failed_mismatch'
  ), 'mismatched Stripe retry mutated the durable failed receipt';

  assert exists(select 1 from app_schema_versions where version='202607260005'),
    'privacy cleanup lifecycle schema version was not recorded';
  assert exists(select 1 from app_schema_versions where version='202607260006'),
    'atomic evidence schema version was not recorded';
  assert exists(select 1 from app_schema_versions where version='202607260007'),
    'retryable Stripe webhook schema version was not recorded';
  assert exists(select 1 from app_schema_versions where version='202607260008'),
    'receipt hash audit-context schema version was not recorded';
  raise notice '=== DURABLE STRIPE WEBHOOK REGRESSIONS PASSED ===';
end;
$$;
