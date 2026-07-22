-- External-beta hardening. All retained-state transitions happen under row
-- locks and append their audit event in the same database transaction.

-- Retire the original browser-writable prototype surface. The production app
-- uses service-owned v2 tables and private evidence uploads only.
drop policy if exists "owners manage milestones" on public.milestones;
drop policy if exists "owners manage sources" on public.source_documents;
drop policy if exists "owners manage analyses" on public.analysis_runs;
drop policy if exists "owners manage criteria" on public.criteria;
drop policy if exists "owners read jobs" on public.jobs;
drop policy if exists "owners read runs" on public.verification_runs;
drop policy if exists "owners read results" on public.criterion_results;
drop policy if exists "owners read artifacts" on public.artifacts;
drop policy if exists "owners manage reviews" on public.review_packets;
drop policy if exists "owners read audit" on public.audit_events;
drop policy if exists "owners upload source files" on storage.objects;
drop policy if exists "owners read source files" on storage.objects;
drop policy if exists "owners read evidence" on storage.objects;
revoke all on table public.milestones, public.source_documents, public.analysis_runs,
  public.criteria, public.jobs, public.verification_runs, public.criterion_results,
  public.artifacts, public.review_packets, public.audit_events from anon, authenticated;

alter table public.transaction_records
  add column if not exists criteria_sha256 text,
  add column if not exists active_job_id uuid;

alter table public.verification_jobs_v2
  add column if not exists criteria_revision integer not null default 1,
  add column if not exists criteria_sha256 text,
  add column if not exists origin_addresses jsonb not null default '[]'::jsonb,
  add column if not exists leased_at timestamptz;

alter table public.review_packets_v2
  add column if not exists criteria_revision integer not null default 1;

create unique index if not exists one_active_verification_job_per_record
  on public.verification_jobs_v2(record_id)
  where status in ('QUEUED','LEASED','RUNNING');

create table if not exists public.operator_action_events (
  id bigint generated always as identity primary key,
  operator_email text not null,
  action_type text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '4 years')
);
alter table public.operator_action_events enable row level security;

alter table public.privacy_requests_v2
  add column if not exists identity_verified_at timestamptz,
  add column if not exists response_summary text,
  add column if not exists response_sent_at timestamptz;

create or replace function public.record_operator_action(
  p_operator_email text, p_action_type text, p_target_type text,
  p_target_id text, p_details jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.operator_action_events(operator_email, action_type, target_type, target_id, details)
  values (p_operator_email, p_action_type, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.queue_verification_job_atomic(
  p_record_id uuid,
  p_record_public_id text,
  p_owner_user_id uuid,
  p_owner_token_hash text,
  p_mode text,
  p_agency_name text,
  p_client_name text,
  p_project_name text,
  p_milestone_title text,
  p_amount_minor bigint,
  p_currency text,
  p_source_name text,
  p_source_sha256 text,
  p_criteria jsonb,
  p_criteria_sha256 text,
  p_target_origin text,
  p_build_url text,
  p_build_label text,
  p_checks jsonb,
  p_runner_version text,
  p_workspace_state jsonb,
  p_actor_hash text,
  p_notice_version text,
  p_origin_addresses jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_record public.transaction_records;
  v_record_id uuid;
  v_job_id uuid := gen_random_uuid();
  v_revision integer := 1;
  v_is_new boolean := p_record_id is null;
begin
  if p_record_id is not null then
    select * into v_record from public.transaction_records where id = p_record_id for update;
    if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then
      raise exception 'Record not found for this owner';
    end if;
    if v_record.status not in ('READY','NEEDS_WORK','CHANGES_REQUESTED','READY_FOR_REVIEW') then
      raise exception 'Record cannot start a run from %', v_record.status;
    end if;
    if exists (select 1 from public.verification_jobs_v2 where record_id = v_record.id and status in ('QUEUED','LEASED','RUNNING')) then
      raise exception 'An active verification job already exists';
    end if;
    v_record_id := v_record.id;
    v_revision := v_record.criteria_revision + case when v_record.criteria_sha256 is distinct from p_criteria_sha256 or v_record.source_sha256 is distinct from p_source_sha256 then 1 else 0 end;
    if v_revision <> v_record.criteria_revision then
      update public.review_packets_v2 set revoked_at = clock_timestamp()
      where record_id = v_record_id and decision is null and revoked_at is null;
    end if;
    update public.transaction_records set
      mode = p_mode, agency_name = p_agency_name, client_name = p_client_name,
      project_name = p_project_name, milestone_title = p_milestone_title,
      amount_minor = p_amount_minor, currency = p_currency, source_name = p_source_name,
      source_sha256 = p_source_sha256, confirmed_criteria = p_criteria,
      criteria_sha256 = p_criteria_sha256, criteria_revision = v_revision,
      target_origin = p_target_origin, workspace_state = p_workspace_state,
      status = 'VERIFYING', active_job_id = v_job_id
    where id = v_record_id;
    if v_revision <> v_record.criteria_revision then
      perform public.append_transaction_event(v_record_id, 'MILESTONE_REVISED', 'OWNER', p_actor_hash,
        jsonb_build_object('criteriaRevision', v_revision, 'sourceSha256', p_source_sha256,
          'criteriaSha256', p_criteria_sha256, 'criteriaCount', jsonb_array_length(p_criteria)));
    end if;
  else
    insert into public.transaction_records(
      public_id, owner_token_hash, owner_user_id, mode, agency_name, client_name,
      project_name, milestone_title, amount_minor, currency, source_name, source_sha256,
      confirmed_criteria, criteria_sha256, target_origin, criteria_revision, status,
      workspace_state, active_job_id
    ) values (
      p_record_public_id, p_owner_token_hash, p_owner_user_id, p_mode, p_agency_name,
      p_client_name, p_project_name, p_milestone_title, p_amount_minor, p_currency,
      p_source_name, p_source_sha256, p_criteria, p_criteria_sha256, p_target_origin,
      1, 'VERIFYING', p_workspace_state, v_job_id
    ) returning id into v_record_id;
    perform public.append_transaction_event(v_record_id, 'MILESTONE_FROZEN', 'OWNER', p_actor_hash,
      jsonb_build_object('publicId', p_record_public_id, 'criteriaRevision', 1,
        'sourceSha256', p_source_sha256, 'criteriaSha256', p_criteria_sha256,
        'criteriaCount', jsonb_array_length(p_criteria), 'criteriaConfirmedByOwner', true,
        'ownerTermsAccepted', true, 'noticeVersion', p_notice_version));
  end if;

  insert into public.verification_jobs_v2(
    id, record_id, status, target_origin, build_url, build_label, checks,
    runner_version, criteria_revision, criteria_sha256, origin_addresses
  ) values (
    v_job_id, v_record_id, 'QUEUED', p_target_origin, p_build_url, p_build_label,
    p_checks, p_runner_version, v_revision, p_criteria_sha256, coalesce(p_origin_addresses, '[]'::jsonb)
  );
  perform public.append_transaction_event(v_record_id, 'VERIFICATION_QUEUED', 'OWNER', p_actor_hash,
    jsonb_build_object('jobId', v_job_id, 'buildLabel', p_build_label,
      'targetOrigin', p_target_origin, 'checkCount', jsonb_array_length(p_checks),
      'criteriaRevision', v_revision));
  return jsonb_build_object('recordId', v_record_id, 'jobId', v_job_id, 'criteriaRevision', v_revision);
end;
$$;

create or replace function public.lease_verification_job_atomic(p_job_id uuid, p_attempt integer)
returns public.verification_jobs_v2 language plpgsql security definer set search_path = public as $$
declare v_job public.verification_jobs_v2;
begin
  select * into v_job from public.verification_jobs_v2 where id = p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status not in ('QUEUED','LEASED','RUNNING') then raise exception 'Job cannot be leased from %', v_job.status; end if;
  if v_job.status in ('LEASED','RUNNING') and v_job.attempt = p_attempt then return v_job; end if;
  update public.verification_jobs_v2 set status='RUNNING', attempt=p_attempt,
    started_at=coalesce(started_at, clock_timestamp()), leased_at=clock_timestamp(), last_error=null
  where id=p_job_id returning * into v_job;
  perform public.append_transaction_event(v_job.record_id, 'VERIFICATION_STARTED', 'RUNNER', null,
    jsonb_build_object('jobId', p_job_id, 'attempt', p_attempt, 'buildLabel', v_job.build_label));
  return v_job;
end;
$$;

create or replace function public.fail_verification_job_atomic(
  p_job_id uuid, p_attempt integer, p_error text, p_event_type text
) returns text language plpgsql security definer set search_path = public as $$
declare v_job public.verification_jobs_v2; v_record public.transaction_records;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status='COMPLETED' then return 'COMPLETED'; end if;
  if v_job.status='FAILED' then return 'DUPLICATE'; end if;
  if v_job.status not in ('QUEUED','LEASED','RUNNING') then raise exception 'Job cannot fail from %', v_job.status; end if;
  select * into v_record from public.transaction_records where id=v_job.record_id for update;
  update public.verification_jobs_v2 set status='FAILED', attempt=p_attempt,
    last_error=p_error, completed_at=clock_timestamp() where id=p_job_id;
  update public.transaction_records set status='READY', active_job_id=null
    where id=v_job.record_id and active_job_id=p_job_id;
  perform public.append_transaction_event(v_job.record_id, p_event_type, 'RUNNER', null,
    jsonb_build_object('jobId', p_job_id, 'attempt', p_attempt, 'error', p_error));
  return 'FAILED';
end;
$$;

-- Replace completion with stale-run protection in addition to manifest checks.
create or replace function public.complete_verification_job_atomic(
  p_job_id uuid, p_attempt integer, p_results jsonb, p_artifacts jsonb,
  p_browser_version text, p_runner_version text, p_manifest_sha256 text,
  p_started_at timestamptz, p_completed_at timestamptz
) returns text language plpgsql security definer set search_path = public as $$
declare v_job public.verification_jobs_v2; v_record public.transaction_records;
  v_check_count integer; v_result_count integer; v_artifact_count integer; v_outcome text;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status='COMPLETED' then return 'DUPLICATE'; end if;
  if v_job.status not in ('QUEUED','LEASED','RUNNING') then raise exception 'Job cannot complete from %', v_job.status; end if;
  select * into v_record from public.transaction_records where id=v_job.record_id for update;
  if v_record.status <> 'VERIFYING' or v_record.active_job_id is distinct from p_job_id
     or v_record.criteria_revision <> v_job.criteria_revision
     or v_record.criteria_sha256 is distinct from v_job.criteria_sha256 then
    raise exception 'Stale verification job cannot update this record';
  end if;
  v_check_count := jsonb_array_length(coalesce(v_job.checks,'[]'::jsonb));
  v_result_count := jsonb_array_length(coalesce(p_results,'[]'::jsonb));
  v_artifact_count := jsonb_array_length(coalesce(p_artifacts,'[]'::jsonb));
  if v_check_count=0 or v_result_count<>v_check_count or v_artifact_count<>v_check_count then raise exception 'Frozen check, result, and artifact counts must match'; end if;
  if (select count(distinct value->>'criterionId') from jsonb_array_elements(p_results))<>v_check_count
     or (select count(distinct value->>'criterionId') from jsonb_array_elements(p_artifacts))<>v_check_count then raise exception 'Criterion IDs must be unique'; end if;
  if exists(select 1 from jsonb_array_elements(v_job.checks) c where not exists(select 1 from jsonb_array_elements(p_results) r where r->>'criterionId'=c->>'criterionId'))
     or exists(select 1 from jsonb_array_elements(v_job.checks) c where not exists(select 1 from jsonb_array_elements(p_artifacts) a where a->>'criterionId'=c->>'criterionId')) then raise exception 'Completion does not cover the frozen manifest'; end if;
  v_outcome := case when not exists(select 1 from jsonb_array_elements(p_results) r where r->>'status'<>'PASS') then 'READY_FOR_REVIEW' else 'NEEDS_WORK' end;
  update public.verification_jobs_v2 set status='COMPLETED', attempt=p_attempt, results=p_results,
    artifacts=p_artifacts, browser_version=p_browser_version, runner_version=p_runner_version,
    manifest_sha256=p_manifest_sha256, started_at=p_started_at, completed_at=p_completed_at,
    last_error=null where id=p_job_id;
  update public.transaction_records set status=v_outcome, last_run_id=p_job_id, active_job_id=null where id=v_job.record_id;
  perform public.append_transaction_event(v_job.record_id,'VERIFICATION_COMPLETED','RUNNER',null,
    jsonb_build_object('jobId',p_job_id,'outcome',v_outcome,'resultCount',v_result_count,
      'artifactCount',v_artifact_count,'manifestSha256',p_manifest_sha256,'criteriaRevision',v_job.criteria_revision,'completedAt',p_completed_at));
  return v_outcome;
end;
$$;

create or replace function public.create_review_packet_atomic(
  p_record_id uuid, p_run_id uuid, p_public_id text, p_snapshot jsonb,
  p_snapshot_sha256 text, p_bearer_token_hash text, p_expires_at timestamptz,
  p_actor_hash text, p_criteria_revision integer
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_packet_id uuid; v_record public.transaction_records; v_run public.verification_jobs_v2;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  select * into v_run from public.verification_jobs_v2 where id=p_run_id and record_id=p_record_id for update;
  if v_record.id is null or v_run.id is null then raise exception 'Record or run not found'; end if;
  if v_record.status<>'READY_FOR_REVIEW' or v_record.last_run_id is distinct from p_run_id then raise exception 'Only the current reviewable run may be shared'; end if;
  if v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_record.criteria_revision or p_criteria_revision<>v_record.criteria_revision then raise exception 'Run criteria revision is stale'; end if;
  if p_snapshot->>'recordId'<>p_record_id::text or p_snapshot#>>'{run,runId}'<>p_run_id::text
     or (p_snapshot->>'revision')::integer<>v_record.criteria_revision then raise exception 'Review snapshot does not match current record'; end if;
  update public.review_packets_v2 set revoked_at=clock_timestamp() where record_id=p_record_id and decision is null and revoked_at is null;
  insert into public.review_packets_v2(record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision)
  values(p_record_id,p_run_id,p_public_id,p_snapshot,p_snapshot_sha256,p_bearer_token_hash,p_expires_at,p_criteria_revision)
  returning id into v_packet_id;
  update public.transaction_records set status='IN_REVIEW' where id=p_record_id;
  perform public.append_transaction_event(p_record_id,'REVIEW_PACKET_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetPublicId',p_public_id,'runId',p_run_id,'criteriaRevision',p_criteria_revision,'snapshotSha256',p_snapshot_sha256,'expiresAt',p_expires_at));
  return v_packet_id;
end;
$$;

create or replace function public.record_review_decision_atomic(
  p_packet_id uuid, p_decision text, p_reviewer_name text, p_reviewer_email text,
  p_reviewer_note text, p_notice_version text, p_actor_hash text, p_country_code text,
  p_decided_at timestamptz, p_receipt_sha256 text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_run public.verification_jobs_v2;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  select * into v_run from public.verification_jobs_v2 where id=v_packet.run_id for update;
  if v_packet.decision is not null then raise exception 'Decision already recorded'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=now() then raise exception 'Review packet unavailable'; end if;
  if v_record.status<>'IN_REVIEW' or v_record.last_run_id is distinct from v_packet.run_id
     or v_record.criteria_revision<>v_packet.criteria_revision or v_run.status<>'COMPLETED'
     or v_run.criteria_revision<>v_packet.criteria_revision then raise exception 'Review packet is stale'; end if;
  update public.review_packets_v2 set decision=p_decision, reviewer_name=p_reviewer_name,
    reviewer_email=p_reviewer_email, reviewer_note=nullif(p_reviewer_note,''), intent_confirmed=true,
    electronic_records_consent=true, notice_version=p_notice_version, actor_hash=p_actor_hash,
    country_code=p_country_code, decided_at=p_decided_at, receipt_sha256=p_receipt_sha256 where id=p_packet_id;
  update public.transaction_records set status=case when p_decision='APPROVED' then 'APPROVED' else 'CHANGES_REQUESTED' end where id=v_packet.record_id;
  perform public.append_transaction_event(v_packet.record_id,case when p_decision='APPROVED' then 'MILESTONE_APPROVED' else 'CHANGES_REQUESTED' end,'REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'runId',v_packet.run_id,'criteriaRevision',v_packet.criteria_revision,
      'snapshotSha256',v_packet.snapshot_sha256,'receiptSha256',p_receipt_sha256,'reviewerName',p_reviewer_name,
      'reviewerEmail',p_reviewer_email,'reviewerNote',p_reviewer_note,'intentConfirmed',true,
      'electronicRecordsConsent',true,'noticeVersion',p_notice_version,'decidedAt',p_decided_at));
  return v_packet.record_id;
end;
$$;

create or replace function public.purge_expired_transaction_record(p_record_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_record public.transaction_records;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.legal_hold or v_record.retention_until>now() then return false; end if;
  if exists(select 1 from public.evidence_artifacts_v2 where record_id=p_record_id and legal_hold) then return false; end if;
  perform set_config('greenlit.retention_purge','on',true);
  delete from public.review_sessions_v2 where packet_id in (select id from public.review_packets_v2 where record_id=p_record_id);
  delete from public.review_packets_v2 where record_id=p_record_id;
  delete from public.evidence_artifacts_v2 where record_id=p_record_id;
  delete from public.verification_jobs_v2 where record_id=p_record_id;
  delete from public.transaction_audit_events where record_id=p_record_id;
  delete from public.transaction_records where id=p_record_id;
  return true;
end;
$$;

-- CREATE OR REPLACE with an added trailing argument creates a new overload
-- rather than replacing the 8-arg version shipped in 202607200005; drop the
-- dead overload explicitly so only the criteria_revision-aware version exists.
drop function if exists public.create_review_packet_atomic(uuid,uuid,text,jsonb,text,text,timestamptz,text);

-- Operator-initiated retry: revision-safe (refuses to retry a failed job
-- whose record has since changed criteria/source), active-job-guarded (the
-- partial unique index on verification_jobs_v2 also enforces this), and
-- atomic with its audit event + operator action log.
create or replace function public.retry_verification_job_atomic(
  p_failed_job_id uuid, p_operator_email text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_failed public.verification_jobs_v2;
  v_record public.transaction_records;
  v_job_id uuid := gen_random_uuid();
begin
  select * into v_failed from public.verification_jobs_v2 where id = p_failed_job_id for update;
  if v_failed.id is null then raise exception 'Job not found'; end if;
  if v_failed.status <> 'FAILED' then raise exception 'Only a failed job can be retried'; end if;
  select * into v_record from public.transaction_records where id = v_failed.record_id for update;
  if v_record.id is null then raise exception 'Record not found'; end if;
  if v_record.criteria_revision <> v_failed.criteria_revision or v_record.criteria_sha256 is distinct from v_failed.criteria_sha256 then
    raise exception 'The milestone changed since this job failed; queue a fresh run instead of retrying';
  end if;
  if v_record.status not in ('READY','NEEDS_WORK','CHANGES_REQUESTED','READY_FOR_REVIEW') then
    raise exception 'Record cannot be retried from %', v_record.status;
  end if;
  if exists (select 1 from public.verification_jobs_v2 where record_id = v_record.id and status in ('QUEUED','LEASED','RUNNING')) then
    raise exception 'An active verification job already exists';
  end if;
  insert into public.verification_jobs_v2(
    id, record_id, status, target_origin, build_url, build_label, checks,
    runner_version, criteria_revision, criteria_sha256, origin_addresses, retry_of
  ) values (
    v_job_id, v_record.id, 'QUEUED', v_failed.target_origin, v_failed.build_url, v_failed.build_label,
    v_failed.checks, v_failed.runner_version, v_failed.criteria_revision, v_failed.criteria_sha256,
    coalesce(v_failed.origin_addresses, '[]'::jsonb), v_failed.id
  );
  update public.transaction_records set status = 'VERIFYING', active_job_id = v_job_id where id = v_record.id;
  perform public.append_transaction_event(v_record.id, 'VERIFICATION_RETRIED', 'SYSTEM', null,
    jsonb_build_object('failedJobId', v_failed.id, 'retryJobId', v_job_id, 'operatorEmail', p_operator_email));
  perform public.record_operator_action(p_operator_email, 'RETRY_VERIFICATION_JOB', 'verification_job', v_failed.id::text,
    jsonb_build_object('retryJobId', v_job_id, 'recordId', v_record.id));
  return jsonb_build_object('jobId', v_job_id, 'recordId', v_record.id, 'targetOrigin', v_failed.target_origin);
end;
$$;

-- Retention: delete a batch of already-storage-removed, non-held evidence
-- rows and append the audit event in the same transaction, so a crash
-- between DB delete and audit write is impossible.
create or replace function public.purge_expired_evidence_atomic(
  p_ids uuid[], p_record_id uuid, p_processed_at timestamptz
) returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if exists (select 1 from public.evidence_artifacts_v2 where id = any(p_ids) and legal_hold) then
    raise exception 'Cannot purge evidence under legal hold';
  end if;
  delete from public.evidence_artifacts_v2 where id = any(p_ids) and record_id = p_record_id;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.append_transaction_event(p_record_id, 'EVIDENCE_RETENTION_EXPIRED', 'SYSTEM', null,
      jsonb_build_object('deletedArtifactCount', v_count, 'processedAt', p_processed_at));
  end if;
  return v_count;
end;
$$;

revoke all on function public.record_operator_action(text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.queue_verification_job_atomic(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text,text,text,text,jsonb,text,jsonb,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.lease_verification_job_atomic(uuid,integer) from public,anon,authenticated;
revoke all on function public.fail_verification_job_atomic(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.create_review_packet_atomic(uuid,uuid,text,jsonb,text,text,timestamptz,text,integer) from public,anon,authenticated;
revoke all on function public.retry_verification_job_atomic(uuid,text) from public,anon,authenticated;
revoke all on function public.purge_expired_evidence_atomic(uuid[],uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_operator_action(text,text,text,text,jsonb) to service_role;
grant execute on function public.queue_verification_job_atomic(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text,text,text,text,jsonb,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.lease_verification_job_atomic(uuid,integer) to service_role;
grant execute on function public.fail_verification_job_atomic(uuid,integer,text,text) to service_role;
grant execute on function public.create_review_packet_atomic(uuid,uuid,text,jsonb,text,text,timestamptz,text,integer) to service_role;
grant execute on function public.retry_verification_job_atomic(uuid,text) to service_role;
grant execute on function public.purge_expired_evidence_atomic(uuid[],uuid,timestamptz) to service_role;
