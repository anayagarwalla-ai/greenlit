\set ON_ERROR_STOP on
set search_path=public,extensions;

begin;

do $$
declare
  v_owner uuid:=gen_random_uuid();
  v_record uuid;
  v_job uuid:=gen_random_uuid();
  v_lease uuid:=gen_random_uuid();
  v_other_lease uuid:=gen_random_uuid();
  v_hash text:=repeat('a',64);
  v_other_hash text:=repeat('b',64);
  v_path text;
  v_other_path text;
  v_expires_at timestamptz:=date_trunc(
    'milliseconds',
    clock_timestamp()+interval '90 days'
  );
  v_result text;
  v_exception_detail text;
  v_criteria jsonb:='[
    {
      "id":"AC-01",
      "title":"Criterion",
      "sourceQuote":"Required source quote",
      "supported":true,
      "checkType":"element_state"
    }
  ]'::jsonb;
  v_checks jsonb:='[
    {
      "id":"CHK-01",
      "criterionId":"AC-01",
      "type":"element_state",
      "path":"/",
      "sourceQuote":"Required source quote",
      "confirmedByHuman":true,
      "elementRef":"main:Content",
      "assertion":"visible"
    }
  ]'::jsonb;
begin
  insert into auth.users(id,email)
  values(v_owner,'atomic-evidence-owner@example.test');

  insert into transaction_records(
    public_id,
    owner_token_hash,
    owner_user_id,
    mode,
    agency_name,
    client_name,
    project_name,
    milestone_title,
    amount_minor,
    currency,
    source_name,
    source_sha256,
    confirmed_criteria,
    criteria_sha256,
    target_origin,
    criteria_revision,
    status
  ) values(
    'MP-ATOMIC-EVIDENCE',
    'atomic-evidence-owner-hash',
    v_owner,
    'IMPORTED_FIXTURE',
    'Agency',
    'Client',
    'Project',
    'Milestone',
    1000,
    'USD',
    'sow.txt',
    'source',
    v_criteria,
    'criteria',
    'https://example.test',
    1,
    'READY'
  ) returning id into v_record;

  insert into verification_jobs_v2(
    id,
    record_id,
    status,
    target_origin,
    build_url,
    build_label,
    checks,
    results,
    artifacts,
    runner_version,
    criteria_revision,
    criteria_sha256,
    origin_addresses,
    attempt,
    lease_id,
    started_at
  ) values(
    v_job,
    v_record,
    'RUNNING',
    'https://example.test',
    'https://example.test',
    'build',
    v_checks,
    '[]'::jsonb,
    '[]'::jsonb,
    '0.9.0',
    1,
    'criteria',
    '["93.184.216.34"]'::jsonb,
    1,
    v_lease,
    clock_timestamp()
  );

  update transaction_records
    set status='VERIFYING',active_job_id=v_job
    where id=v_record;

  v_path:=v_record::text||'/'||v_job::text||'/AC-01-'||
    v_lease::text||'-screenshot-'||v_hash||'.jpg';
  v_other_path:=v_record::text||'/'||v_job::text||'/AC-01-'||
    v_lease::text||'-axe-'||v_other_hash||'.json';

  v_result:=record_evidence_artifact_atomic(
    v_job,
    v_lease,
    'AC-01',
    'SCREENSHOT',
    v_path,
    'image/jpeg',
    128,
    v_hash,
    v_expires_at
  );
  assert v_result='RECORDED', 'first artifact was not recorded';
  assert (
    select count(*)=1
      and min(storage_path)=v_path
      and min(expires_at)=v_expires_at
    from evidence_artifacts_v2
    where run_id=v_job and criterion_id='AC-01'
  ), 'recorded artifact metadata is not canonical';

  v_result:=record_evidence_artifact_atomic(
    v_job,
    v_lease,
    'AC-01',
    'SCREENSHOT',
    v_path,
    'image/jpeg',
    128,
    v_hash,
    v_expires_at+interval '1 day'
  );
  assert v_result='DUPLICATE', 'exact replay was not idempotent';
  assert (
    select count(*)=1 and min(expires_at)=v_expires_at
    from evidence_artifacts_v2
    where run_id=v_job and criterion_id='AC-01'
  ), 'duplicate replay changed the frozen artifact or expiry';

  begin
    perform record_evidence_artifact_atomic(
      v_job,
      v_lease,
      'AC-01',
      'AXE',
      v_other_path,
      'application/json',
      128,
      v_other_hash,
      v_expires_at
    );
    raise exception 'ARTIFACT CHECK FAILED: a second kind occupied one criterion';
  exception when others then
    get stacked diagnostics v_exception_detail=pg_exception_detail;
    if sqlerrm like 'ARTIFACT CHECK FAILED:%' then raise; end if;
    if v_exception_detail<>'EVIDENCE_SLOT_CONFLICT' then
      raise exception 'second-kind conflict did not expose its stable detail';
    end if;
  end;
  assert (
    select count(*)=1 from evidence_artifacts_v2
    where run_id=v_job and criterion_id='AC-01'
  ), 'second-kind conflict changed the frozen criterion slot';

  begin
    perform record_evidence_artifact_atomic(
      v_job,
      v_lease,
      'AC-01',
      'SCREENSHOT',
      v_path,
      'image/jpeg',
      0,
      v_hash,
      v_expires_at
    );
    raise exception 'ARTIFACT CHECK FAILED: zero-byte evidence was accepted';
  exception when others then
    get stacked diagnostics v_exception_detail=pg_exception_detail;
    if sqlerrm like 'ARTIFACT CHECK FAILED:%' then raise; end if;
    if v_exception_detail<>'EVIDENCE_METADATA_INVALID' then
      raise exception 'zero-byte rejection did not expose its stable detail';
    end if;
  end;

  begin
    perform record_evidence_artifact_atomic(
      v_job,
      v_other_lease,
      'AC-01',
      'SCREENSHOT',
      v_path,
      'image/jpeg',
      128,
      v_hash,
      v_expires_at
    );
    raise exception 'ARTIFACT CHECK FAILED: a stale lease recorded evidence';
  exception when others then
    get stacked diagnostics v_exception_detail=pg_exception_detail;
    if sqlerrm like 'ARTIFACT CHECK FAILED:%' then raise; end if;
    if v_exception_detail<>'STALE_EVIDENCE_LEASE' then
      raise exception 'stale-lease rejection did not expose its stable detail';
    end if;
  end;

  update verification_jobs_v2
    set status='COMPLETED',completed_at=clock_timestamp()
    where id=v_job;
  begin
    perform record_evidence_artifact_atomic(
      v_job,
      v_lease,
      'AC-01',
      'SCREENSHOT',
      v_path,
      'image/jpeg',
      128,
      v_hash,
      v_expires_at
    );
    raise exception 'ARTIFACT CHECK FAILED: completed job accepted evidence';
  exception when others then
    get stacked diagnostics v_exception_detail=pg_exception_detail;
    if sqlerrm like 'ARTIFACT CHECK FAILED:%' then raise; end if;
    if v_exception_detail<>'STALE_EVIDENCE_LEASE' then
      raise exception 'completed-job rejection did not expose its stable detail';
    end if;
  end;
  assert (
    select count(*)=1 and min(storage_path)=v_path
    from evidence_artifacts_v2
    where run_id=v_job and criterion_id='AC-01'
  ), 'post-completion rejection changed pre-existing evidence';

  assert exists(
    select 1
    from pg_indexes
    where schemaname='public'
      and indexname='one_evidence_artifact_per_run_criterion'
  ), 'criterion-wide artifact uniqueness is missing';
  assert has_function_privilege(
    'service_role',
    'public.record_evidence_artifact_atomic(uuid,uuid,text,text,text,text,integer,text,timestamptz)',
    'EXECUTE'
  ), 'service role cannot record evidence atomically';
  assert not has_function_privilege(
    'authenticated',
    'public.record_evidence_artifact_atomic(uuid,uuid,text,text,text,text,integer,text,timestamptz)',
    'EXECUTE'
  ), 'authenticated users can call the internal evidence recorder';
  assert exists(
    select 1 from app_schema_versions where version='202607260006'
  ), 'atomic evidence schema version was not recorded';

  raise notice '=== ATOMIC EVIDENCE ARTIFACT REGRESSIONS PASSED ===';
end;
$$;

rollback;
