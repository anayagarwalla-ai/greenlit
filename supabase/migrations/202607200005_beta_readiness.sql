-- Beta-readiness hardening: resumable workspaces, isolated review sessions,
-- atomic business transitions, and actionable operator queues.

alter table public.transaction_records
  add column if not exists workspace_state jsonb not null default '{}'::jsonb,
  add column if not exists criteria_revision integer not null default 1 check (criteria_revision > 0),
  add column if not exists last_run_id uuid;

alter table public.verification_jobs_v2
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text,
  add column if not exists retry_of uuid references public.verification_jobs_v2(id) on delete restrict;

alter table public.privacy_requests_v2
  add column if not exists assigned_to text,
  add column if not exists internal_notes text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.operator_notifications
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_error text,
  add column if not exists last_delivery_at timestamptz;

create table if not exists public.review_sessions_v2 (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.review_packets_v2(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists review_sessions_v2_packet_idx
  on public.review_sessions_v2(packet_id, expires_at desc);

alter table public.review_sessions_v2 enable row level security;

create or replace function public.complete_verification_job_atomic(
  p_job_id uuid,
  p_attempt integer,
  p_results jsonb,
  p_artifacts jsonb,
  p_browser_version text,
  p_runner_version text,
  p_manifest_sha256 text,
  p_started_at timestamptz,
  p_completed_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.verification_jobs_v2;
  v_check_count integer;
  v_result_count integer;
  v_artifact_count integer;
  v_outcome text;
begin
  select * into v_job from public.verification_jobs_v2 where id = p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status = 'COMPLETED' then return 'DUPLICATE'; end if;
  if v_job.status not in ('QUEUED','LEASED','RUNNING') then raise exception 'Job cannot complete from %', v_job.status; end if;

  v_check_count := jsonb_array_length(coalesce(v_job.checks, '[]'::jsonb));
  v_result_count := jsonb_array_length(coalesce(p_results, '[]'::jsonb));
  v_artifact_count := jsonb_array_length(coalesce(p_artifacts, '[]'::jsonb));
  if v_check_count = 0 or v_result_count <> v_check_count then
    raise exception 'Every frozen check must have exactly one result';
  end if;
  if (select count(distinct value->>'criterionId') from jsonb_array_elements(p_results)) <> v_check_count then
    raise exception 'Result criterion IDs must be unique';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_job.checks) c
    where not exists (select 1 from jsonb_array_elements(p_results) r where r->>'criterionId' = c->>'criterionId')
  ) or exists (
    select 1 from jsonb_array_elements(p_results) r
    where not exists (select 1 from jsonb_array_elements(v_job.checks) c where c->>'criterionId' = r->>'criterionId')
  ) then raise exception 'Result manifest does not match frozen checks'; end if;
  if v_artifact_count <> v_check_count then raise exception 'Every frozen check must have one evidence artifact'; end if;
  if (select count(distinct value->>'criterionId') from jsonb_array_elements(p_artifacts)) <> v_check_count then
    raise exception 'Evidence criterion IDs must be unique';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_job.checks) c
    where not exists (select 1 from jsonb_array_elements(p_artifacts) a where a->>'criterionId' = c->>'criterionId')
  ) then raise exception 'Evidence manifest does not cover every frozen check'; end if;

  v_outcome := case when not exists (
    select 1 from jsonb_array_elements(p_results) r where r->>'status' <> 'PASS'
  ) then 'READY_FOR_REVIEW' else 'NEEDS_WORK' end;

  update public.verification_jobs_v2 set
    status = 'COMPLETED', attempt = p_attempt, results = p_results, artifacts = p_artifacts,
    browser_version = p_browser_version, runner_version = p_runner_version,
    manifest_sha256 = p_manifest_sha256, started_at = p_started_at,
    completed_at = p_completed_at, last_error = null
  where id = p_job_id;
  update public.transaction_records set status = v_outcome, last_run_id = p_job_id where id = v_job.record_id;
  perform public.append_transaction_event(v_job.record_id, 'VERIFICATION_COMPLETED', 'RUNNER', null,
    jsonb_build_object('jobId', p_job_id, 'outcome', v_outcome, 'resultCount', v_result_count,
      'artifactCount', v_artifact_count, 'manifestSha256', p_manifest_sha256, 'completedAt', p_completed_at));
  return v_outcome;
end;
$$;

create or replace function public.create_review_packet_atomic(
  p_record_id uuid,
  p_run_id uuid,
  p_public_id text,
  p_snapshot jsonb,
  p_snapshot_sha256 text,
  p_bearer_token_hash text,
  p_expires_at timestamptz,
  p_actor_hash text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_packet_id uuid;
begin
  perform 1 from public.transaction_records where id = p_record_id for update;
  update public.review_packets_v2 set revoked_at = clock_timestamp()
    where record_id = p_record_id and decision is null and revoked_at is null;
  insert into public.review_packets_v2(record_id, run_id, public_id, snapshot, snapshot_sha256, bearer_token_hash, expires_at)
  values (p_record_id, p_run_id, p_public_id, p_snapshot, p_snapshot_sha256, p_bearer_token_hash, p_expires_at)
  returning id into v_packet_id;
  update public.transaction_records set status = 'IN_REVIEW' where id = p_record_id;
  perform public.append_transaction_event(p_record_id, 'REVIEW_PACKET_CREATED', 'OWNER', p_actor_hash,
    jsonb_build_object('packetPublicId', p_public_id, 'runId', p_run_id,
      'snapshotSha256', p_snapshot_sha256, 'expiresAt', p_expires_at));
  return v_packet_id;
end;
$$;

create or replace function public.record_review_decision_atomic(
  p_packet_id uuid,
  p_decision text,
  p_reviewer_name text,
  p_reviewer_email text,
  p_reviewer_note text,
  p_notice_version text,
  p_actor_hash text,
  p_country_code text,
  p_decided_at timestamptz,
  p_receipt_sha256 text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_packet public.review_packets_v2;
begin
  select * into v_packet from public.review_packets_v2 where id = p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  if v_packet.decision is not null then raise exception 'Decision already recorded'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at <= now() then raise exception 'Review packet unavailable'; end if;
  update public.review_packets_v2 set decision = p_decision, reviewer_name = p_reviewer_name,
    reviewer_email = p_reviewer_email, reviewer_note = nullif(p_reviewer_note, ''),
    intent_confirmed = true, electronic_records_consent = true,
    notice_version = p_notice_version, actor_hash = p_actor_hash, country_code = p_country_code,
    decided_at = p_decided_at, receipt_sha256 = p_receipt_sha256 where id = p_packet_id;
  update public.transaction_records set status = case when p_decision = 'APPROVED' then 'APPROVED' else 'CHANGES_REQUESTED' end
    where id = v_packet.record_id;
  perform public.append_transaction_event(v_packet.record_id,
    case when p_decision = 'APPROVED' then 'MILESTONE_APPROVED' else 'CHANGES_REQUESTED' end,
    'REVIEWER', p_actor_hash,
    jsonb_build_object('packetId', v_packet.public_id, 'snapshotSha256', v_packet.snapshot_sha256,
      'receiptSha256', p_receipt_sha256, 'reviewerName', p_reviewer_name,
      'reviewerEmail', p_reviewer_email, 'reviewerNote', p_reviewer_note,
      'intentConfirmed', true, 'electronicRecordsConsent', true,
      'noticeVersion', p_notice_version, 'decidedAt', p_decided_at));
  return v_packet.record_id;
end;
$$;

revoke all on function public.complete_verification_job_atomic(uuid, integer, jsonb, jsonb, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.create_review_packet_atomic(uuid, uuid, text, jsonb, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.record_review_decision_atomic(uuid, text, text, text, text, text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.complete_verification_job_atomic(uuid, integer, jsonb, jsonb, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.create_review_packet_atomic(uuid, uuid, text, jsonb, text, text, timestamptz, text) to service_role;
grant execute on function public.record_review_decision_atomic(uuid, text, text, text, text, text, text, text, timestamptz, text) to service_role;
