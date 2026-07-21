-- Final supervised-beta launch safety pass.
-- This migration removes legacy browser ownership, makes job recovery and
-- notification delivery claim-safe, expands privacy-subject coverage, and
-- records operational/consent state without retaining source-document text.

alter table public.transaction_records alter column owner_token_hash drop not null;
update public.transaction_records set owner_token_hash = null where owner_user_id is not null;

alter table public.privacy_record_amendments
  alter column request_id drop not null;
alter table public.privacy_record_amendments
  drop constraint if exists privacy_record_amendments_request_id_fkey;
alter table public.privacy_record_amendments
  add constraint privacy_record_amendments_request_id_fkey
  foreign key (request_id) references public.privacy_requests_v2(id) on delete set null;

alter table public.operator_notifications
  add column if not exists delivery_claimed_at timestamptz,
  add column if not exists delivery_claim_id uuid;
alter table public.operator_notifications drop constraint if exists operator_notifications_delivery_status_check;
alter table public.operator_notifications add constraint operator_notifications_delivery_status_check
  check (delivery_status in ('IN_APP','PENDING_EMAIL','SENDING','SENT','FAILED'));

alter table public.review_packets_v2
  add column if not exists decision_event_hash text,
  add column if not exists legal_terms_accepted boolean;

create table if not exists public.receipt_sessions_v2 (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.review_packets_v2(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.receipt_sessions_v2 enable row level security;
create index if not exists receipt_sessions_v2_packet_idx on public.receipt_sessions_v2(packet_id,expires_at);

create table if not exists public.analysis_consent_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  actor_hash text,
  country_code text,
  source_mode text not null check (source_mode in ('PASTE','UPLOAD')),
  source_byte_size integer not null check (source_byte_size >= 0),
  notice_version text not null,
  provider_notice_version text not null,
  accepted_terms boolean not null,
  accepted_data_notice boolean not null,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '4 years')
);
alter table public.analysis_consent_events enable row level security;
create index if not exists analysis_consent_events_owner_idx on public.analysis_consent_events(owner_user_id,created_at desc);

create table if not exists public.privacy_account_deletions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.privacy_requests_v2(id) on delete set null,
  auth_user_id uuid not null,
  email text not null,
  status text not null default 'PENDING' check (status in ('PENDING','FAILED','COMPLETED')),
  attempts integer not null default 0,
  last_error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  retention_until timestamptz not null default (now() + interval '4 years')
);
alter table public.privacy_account_deletions enable row level security;
create unique index if not exists one_open_privacy_account_deletion on public.privacy_account_deletions(auth_user_id) where status in ('PENDING','FAILED');
revoke all on table public.privacy_account_deletions from public,anon,authenticated;

create table if not exists public.notification_delivery_attempts (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.operator_notifications(id) on delete cascade,
  claim_id uuid not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null,
  http_status integer,
  error text
);
alter table public.notification_delivery_attempts enable row level security;
create index if not exists notification_delivery_attempts_notification_idx on public.notification_delivery_attempts(notification_id,attempted_at desc);

create table if not exists public.maintenance_runs (
  id bigint generated always as identity primary key,
  task text not null,
  status text not null check (status in ('RUNNING','SUCCEEDED','FAILED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error text,
  retention_until timestamptz not null default (now() + interval '2 years')
);
alter table public.maintenance_runs enable row level security;
create index if not exists maintenance_runs_task_idx on public.maintenance_runs(task,started_at desc);

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'INVITED' check (status in ('INVITED','ACTIVE','REMOVED')),
  adult_sponsor text,
  invited_by text,
  invited_at timestamptz not null default now(),
  last_sign_in_requested_at timestamptz,
  removed_at timestamptz,
  notes text,
  retention_until timestamptz not null default (now() + interval '4 years')
);
alter table public.beta_invites enable row level security;

create or replace function public.manage_beta_invite_atomic(p_email text,p_status text,p_responsible_operator text,p_operator_email text,p_now timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_status not in ('ACTIVE','REMOVED') or nullif(trim(p_email),'') is null or nullif(trim(p_responsible_operator),'') is null then raise exception 'Invalid beta invitation update'; end if;
  insert into public.beta_invites(email,status,adult_sponsor,invited_by,invited_at,removed_at)
  values(lower(trim(p_email)),p_status,trim(p_responsible_operator),p_operator_email,p_now,case when p_status='REMOVED' then p_now else null end)
  on conflict(email) do update set status=excluded.status,adult_sponsor=excluded.adult_sponsor,invited_by=excluded.invited_by,removed_at=excluded.removed_at
  returning id into v_id;
  perform public.record_operator_action(p_operator_email,case when p_status='ACTIVE' then 'ACTIVATE_BETA_INVITE' else 'REMOVE_BETA_INVITE' end,'beta_invite',v_id::text,jsonb_build_object('email',lower(trim(p_email)),'responsibleOperator',trim(p_responsible_operator)));
  return v_id;
end; $$;

create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  record_id uuid references public.transaction_records(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '180 days')
);
alter table public.product_events enable row level security;
create index if not exists product_events_type_idx on public.product_events(event_type,created_at desc);

create or replace function public.evidence_storage_usage_bytes()
returns bigint language sql security definer set search_path=public as $$
  select coalesce(sum(byte_size),0)::bigint from public.evidence_artifacts_v2
$$;

create table if not exists public.legal_holds_v2 (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.transaction_records(id) on delete restrict,
  privacy_request_id uuid references public.privacy_requests_v2(id) on delete set null,
  reason text not null,
  owner_email text not null,
  review_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by text
);
alter table public.legal_holds_v2 enable row level security;
create unique index if not exists one_active_hold_per_matter on public.legal_holds_v2(record_id,privacy_request_id) where active;
create index if not exists legal_holds_v2_active_idx on public.legal_holds_v2(record_id,active);

create or replace function public.privacy_subject_record_ids(p_email text)
returns table(record_id uuid)
language sql security definer set search_path=public,auth as $$
  select r.id
  from public.transaction_records r
  join auth.users u on u.id=r.owner_user_id
  where lower(u.email)=lower(p_email)
  union
  select p.record_id
  from public.review_packets_v2 p
  where p.reviewer_email is not null and lower(p.reviewer_email)=lower(p_email)
$$;

create or replace function public.validate_verification_checks_manifest()
returns trigger language plpgsql set search_path=public as $$
declare v_count integer;
begin
  if jsonb_typeof(new.checks)<>'array' then raise exception 'Checks must be an array'; end if;
  v_count:=jsonb_array_length(new.checks);
  if v_count<1 or v_count>6 then raise exception 'A retained run requires between 1 and 6 automated checks'; end if;
  if (select count(distinct item->>'id') from jsonb_array_elements(new.checks) item)<>v_count
     or (select count(distinct item->>'criterionId') from jsonb_array_elements(new.checks) item)<>v_count
     or exists(select 1 from jsonb_array_elements(new.checks) item where coalesce(item->>'id','')='' or coalesce(item->>'criterionId','')='') then
    raise exception 'Check and criterion identifiers must be complete and unique';
  end if;
  return new;
end; $$;
drop trigger if exists verification_jobs_v2_manifest_guard on public.verification_jobs_v2;
create trigger verification_jobs_v2_manifest_guard before insert or update of checks on public.verification_jobs_v2
for each row execute function public.validate_verification_checks_manifest();

create or replace function public.expire_stale_verification_jobs_atomic(
  p_stale_before timestamptz,p_operator_email text,p_limit integer default 50
) returns integer language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2; v_count integer:=0;
begin
  for v_job in
    select * from public.verification_jobs_v2
    where status in ('QUEUED','LEASED','RUNNING')
      and coalesce(leased_at,started_at,created_at)<p_stale_before
    order by created_at for update skip locked limit greatest(1,least(p_limit,200))
  loop
    update public.verification_jobs_v2 set status='EXPIRED',last_error='Verification exceeded the recovery window and was closed safely.',completed_at=clock_timestamp() where id=v_job.id;
    update public.transaction_records set status='READY',active_job_id=null where id=v_job.record_id and active_job_id=v_job.id;
    perform public.append_transaction_event(v_job.record_id,'VERIFICATION_EXPIRED','SYSTEM',null,
      jsonb_build_object('jobId',v_job.id,'previousStatus',v_job.status,'staleBefore',p_stale_before));
    perform public.record_operator_action(p_operator_email,'EXPIRE_STALE_JOB','verification_job',v_job.id::text,jsonb_build_object('recordId',v_job.record_id));
    v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;

create or replace function public.resolve_verification_job_atomic(
  p_job_id uuid,p_operator_email text,p_reason text,p_now timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Verification job not found'; end if;
  if v_job.status not in ('QUEUED','LEASED','RUNNING') then raise exception 'Only an active job can be resolved'; end if;
  update public.verification_jobs_v2 set status='EXPIRED',last_error=left(coalesce(nullif(trim(p_reason),''),'Closed by the operator.'),300),completed_at=p_now,acknowledged_at=p_now,acknowledged_by=p_operator_email where id=p_job_id;
  update public.transaction_records set status='READY',active_job_id=null where id=v_job.record_id and active_job_id=p_job_id;
  perform public.append_transaction_event(v_job.record_id,'VERIFICATION_CANCELLED','SYSTEM',null,jsonb_build_object('jobId',p_job_id,'reason',p_reason));
  perform public.record_operator_action(p_operator_email,'RESOLVE_ACTIVE_JOB','verification_job',p_job_id::text,jsonb_build_object('recordId',v_job.record_id,'reason',p_reason));
  return true;
end; $$;

create or replace function public.retry_verification_job_atomic(
  p_failed_job_id uuid,p_operator_email text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_failed public.verification_jobs_v2; v_record public.transaction_records; v_job_id uuid:=gen_random_uuid();
begin
  select * into v_failed from public.verification_jobs_v2 where id=p_failed_job_id for update;
  if v_failed.id is null then raise exception 'Job not found'; end if;
  if v_failed.status not in ('FAILED','EXPIRED') then raise exception 'Only a failed or expired job can be retried'; end if;
  select * into v_record from public.transaction_records where id=v_failed.record_id for update;
  if v_record.id is null then raise exception 'Record not found'; end if;
  if v_record.active_job_id is not null then raise exception 'An active verification job already exists'; end if;
  if v_record.criteria_revision<>v_failed.criteria_revision or v_record.criteria_sha256 is distinct from v_failed.criteria_sha256 then raise exception 'The milestone changed; queue a fresh owner-confirmed run'; end if;
  if v_record.status not in ('READY','NEEDS_WORK','CHANGES_REQUESTED') then raise exception 'Record cannot be retried from %',v_record.status; end if;
  if exists(select 1 from public.verification_jobs_v2 newer where newer.record_id=v_failed.record_id and newer.created_at>v_failed.created_at) then raise exception 'A newer verification job superseded this failure'; end if;
  if exists(select 1 from jsonb_array_elements(v_failed.checks) item where item->>'type'='form_submission') then raise exception 'A form-submission job cannot be retried automatically; the owner must confirm and queue a fresh run'; end if;
  insert into public.verification_jobs_v2(id,record_id,status,target_origin,build_url,build_label,checks,runner_version,criteria_revision,criteria_sha256,origin_addresses,retry_of)
  values(v_job_id,v_record.id,'QUEUED',v_failed.target_origin,v_failed.build_url,v_failed.build_label,v_failed.checks,v_failed.runner_version,v_failed.criteria_revision,v_failed.criteria_sha256,coalesce(v_failed.origin_addresses,'[]'::jsonb),v_failed.id);
  update public.transaction_records set status='VERIFYING',active_job_id=v_job_id where id=v_record.id;
  perform public.append_transaction_event(v_record.id,'VERIFICATION_RETRIED','SYSTEM',null,jsonb_build_object('failedJobId',v_failed.id,'retryJobId',v_job_id));
  perform public.record_operator_action(p_operator_email,'RETRY_VERIFICATION_JOB','verification_job',v_failed.id::text,jsonb_build_object('retryJobId',v_job_id,'recordId',v_record.id));
  return jsonb_build_object('jobId',v_job_id,'recordId',v_record.id,'targetOrigin',v_failed.target_origin);
end; $$;

create or replace function public.begin_notification_delivery_atomic(p_id uuid,p_now timestamptz)
returns public.operator_notifications language plpgsql security definer set search_path=public as $$
declare v_notification public.operator_notifications; v_claim uuid:=gen_random_uuid();
begin
  update public.operator_notifications
  set delivery_status='SENDING',delivery_claimed_at=p_now,delivery_claim_id=v_claim,
      delivery_attempts=delivery_attempts+1,last_delivery_at=p_now
  where id=p_id and (delivery_status in ('PENDING_EMAIL','FAILED') or (delivery_status='SENDING' and delivery_claimed_at<p_now-interval '10 minutes'))
  returning * into v_notification;
  return v_notification;
end; $$;

create or replace function public.complete_notification_delivery_atomic(
  p_id uuid,p_claim_id uuid,p_succeeded boolean,p_http_status integer,p_error text,p_now timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.operator_notifications set delivery_status=case when p_succeeded then 'SENT' else 'FAILED' end,
    delivery_error=case when p_succeeded then null else left(coalesce(p_error,'Notification delivery failed'),500) end,
    last_delivery_at=p_now,delivery_claimed_at=null,delivery_claim_id=null
  where id=p_id and delivery_claim_id=p_claim_id and delivery_status='SENDING';
  if not found then return false; end if;
  insert into public.notification_delivery_attempts(notification_id,claim_id,attempted_at,succeeded,http_status,error)
  values(p_id,p_claim_id,p_now,p_succeeded,p_http_status,case when p_succeeded then null else left(coalesce(p_error,'Notification delivery failed'),500) end);
  return true;
end; $$;

create or replace function public.prepare_notification_retry_atomic(p_id uuid,p_operator_email text,p_now timestamptz)
returns public.operator_notifications language plpgsql security definer set search_path=public as $$
declare v_notification public.operator_notifications;
begin
  update public.operator_notifications set delivery_status='PENDING_EMAIL',delivery_claimed_at=null,delivery_claim_id=null,last_delivery_at=p_now
  where id=p_id and delivery_status in ('FAILED','PENDING_EMAIL') returning * into v_notification;
  if v_notification.id is null then raise exception 'Only a pending or failed notification can be retried'; end if;
  perform public.record_operator_action(p_operator_email,'RETRY_NOTIFICATION_DELIVERY','operator_notification',p_id::text,jsonb_build_object('attemptsPreserved',v_notification.delivery_attempts));
  return v_notification;
end; $$;

create or replace function public.set_privacy_legal_hold_atomic(p_request_id uuid,p_enabled boolean,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2; v_record_id uuid; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null then raise exception 'Privacy request not found'; end if;
  if v_request.identity_verified_at is null then raise exception 'Verify the requester before changing legal holds'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  for v_record_id in select record_id from public.privacy_subject_record_ids(v_request.email) loop
    if p_enabled then
      if exists(select 1 from public.transaction_records where id=v_record_id and deletion_status='PENDING') then raise exception 'Deletion is already in progress for a matched record'; end if;
      insert into public.legal_holds_v2(record_id,privacy_request_id,reason,owner_email,review_at)
      values(v_record_id,p_request_id,'Privacy request '||v_request.public_id,p_operator_email,p_now+interval '90 days')
      on conflict (record_id,privacy_request_id) where active do nothing;
    else
      update public.legal_holds_v2 set active=false,released_at=p_now,released_by=p_operator_email where record_id=v_record_id and privacy_request_id=p_request_id and active;
    end if;
    update public.transaction_records set legal_hold=exists(select 1 from public.legal_holds_v2 h where h.record_id=v_record_id and h.active) where id=v_record_id;
    update public.evidence_artifacts_v2 set legal_hold=exists(select 1 from public.legal_holds_v2 h where h.record_id=v_record_id and h.active) where record_id=v_record_id;
    perform public.append_transaction_event(v_record_id,case when p_enabled then 'LEGAL_HOLD_APPLIED' else 'LEGAL_HOLD_RELEASED' end,'SYSTEM',v_actor_hash,jsonb_build_object('privacyRequestId',v_request.public_id,'occurredAt',p_now));
    v_count:=v_count+1;
  end loop;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id and status not in ('COMPLETED','DENIED');
  perform public.record_operator_action(p_operator_email,case when p_enabled then 'APPLY_PRIVACY_LEGAL_HOLD' else 'RELEASE_PRIVACY_LEGAL_HOLD' end,'privacy_request',p_request_id::text,jsonb_build_object('recordCount',v_count));
  return v_count;
end; $$;

create or replace function public.record_privacy_correction_atomic(
  p_request_id uuid,p_record_id uuid,p_field_name text,p_corrected_value text,p_reason text,p_operator_email text,p_now timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2; v_record public.transaction_records; v_previous text; v_id uuid; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  select * into v_record from public.transaction_records where id=p_record_id and id in (select record_id from public.privacy_subject_record_ids(v_request.email)) for update;
  if v_request.identity_verified_at is null or v_record.id is null then raise exception 'Verified requester record not found'; end if;
  v_previous:=case p_field_name when 'agency_name' then v_record.agency_name when 'client_name' then v_record.client_name when 'project_name' then v_record.project_name when 'milestone_title' then v_record.milestone_title else null end;
  if v_previous is null or nullif(trim(p_corrected_value),'') is null or nullif(trim(p_reason),'') is null then raise exception 'Invalid correction'; end if;
  insert into public.privacy_record_amendments(request_id,record_id,field_name,previous_value,corrected_value,reason,operator_email,created_at)
  values(p_request_id,p_record_id,p_field_name,v_previous,trim(p_corrected_value),trim(p_reason),p_operator_email,p_now) returning id into v_id;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  perform public.append_transaction_event(p_record_id,'PRIVACY_CORRECTION_RECORDED','SYSTEM',v_actor_hash,jsonb_build_object('amendmentId',v_id,'privacyRequestId',v_request.public_id,'field',p_field_name,'correctedValue',trim(p_corrected_value),'reason',trim(p_reason)));
  perform public.record_operator_action(p_operator_email,'RECORD_PRIVACY_CORRECTION','transaction_record',p_record_id::text,jsonb_build_object('requestId',p_request_id,'amendmentId',v_id,'field',p_field_name));
  return v_id;
end; $$;

create or replace function public.schedule_privacy_deletion_atomic(p_request_id uuid,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2; v_record_id uuid; v_owner_user_id uuid; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null or v_request.identity_verified_at is null then raise exception 'Verify the requester before scheduling deletion'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  select id into v_owner_user_id from auth.users where lower(email)=lower(v_request.email) limit 1;
  -- Only records owned by the requester are scheduled for whole-record
  -- deletion. A client reviewer must never be able to erase an agency's
  -- legal record; the operator may instead deny/limit that request under the
  -- documented retention basis after exporting the reviewer's data.
  for v_record_id in select id from public.transaction_records where owner_user_id=v_owner_user_id loop
    update public.transaction_records set privacy_deletion_requested_at=p_now,privacy_request_id=p_request_id,retention_until=least(retention_until,p_now) where id=v_record_id;
    perform public.append_transaction_event(v_record_id,'PRIVACY_DELETION_SCHEDULED','SYSTEM',v_actor_hash,jsonb_build_object('privacyRequestId',v_request.public_id,'scheduledAt',p_now));
    v_count:=v_count+1;
  end loop;
  delete from public.beta_feedback where lower(email)=lower(v_request.email) or (v_owner_user_id is not null and owner_user_id=v_owner_user_id);
  if v_owner_user_id is not null then
    delete from public.operator_notifications where owner_user_id=v_owner_user_id;
    delete from public.analysis_consent_events where owner_user_id=v_owner_user_id;
    delete from public.product_events where owner_user_id=v_owner_user_id;
    update public.beta_invites set status='REMOVED',removed_at=p_now,notes='Account deletion requested through '||v_request.public_id where lower(email)=lower(v_request.email);
    if not exists(select 1 from public.privacy_account_deletions where auth_user_id=v_owner_user_id and status in ('PENDING','FAILED')) then
      insert into public.privacy_account_deletions(request_id,auth_user_id,email,requested_at) values(p_request_id,v_owner_user_id,lower(v_request.email),p_now);
    end if;
  end if;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id;
  perform public.record_operator_action(p_operator_email,'SCHEDULE_PRIVACY_DELETION','privacy_request',p_request_id::text,jsonb_build_object('ownedRecordCount',v_count,'accountCleanupQueued',v_owner_user_id is not null,'reviewerRecordsRetainedForOperatorDecision',(select count(*) from public.privacy_subject_record_ids(v_request.email) s where s.record_id not in(select id from public.transaction_records where owner_user_id=v_owner_user_id))));
  return v_count;
end; $$;

create or replace function public.fail_record_deletion_atomic(p_record_id uuid,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.transaction_records set deletion_status='FAILED',deletion_error=left(p_error,1000) where id=p_record_id;
  if not found then return false; end if;
  insert into public.operational_events(severity,service,event_type,record_id,details)
  values('ERROR','retention','RECORD_DELETION_FAILED',p_record_id,jsonb_build_object('error',left(p_error,1000)));
  return true;
end; $$;

create or replace function public.retry_record_deletion_atomic(p_record_id uuid,p_operator_email text,p_now timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.transaction_records set deletion_status='PENDING',deletion_error=null
  where id=p_record_id and deletion_status='FAILED' and privacy_deletion_requested_at is not null;
  if not found then return false; end if;
  perform public.record_operator_action(p_operator_email,'RETRY_RECORD_DELETION','transaction_record',p_record_id::text,jsonb_build_object('queuedAt',p_now));
  insert into public.operational_events(severity,service,event_type,record_id,details)
  values('INFO','retention','RECORD_DELETION_REQUEUED',p_record_id,jsonb_build_object('operator',p_operator_email,'queuedAt',p_now));
  return true;
end; $$;

-- Rebuild the decision transaction so the receipt digest is the final
-- decision event hash. This binds the receipt to the audit-chain head without
-- a circular hash field inside the event payload.
drop function if exists public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text);
create or replace function public.record_review_decision_with_notification_atomic(
  p_packet_id uuid,p_decision text,p_reviewer_name text,p_reviewer_email text,
  p_reviewer_note text,p_notice_version text,p_actor_hash text,p_country_code text,
  p_decided_at timestamptz,p_receipt_sha256 text,p_delivery_status text,
  p_receipt_session_hash text,p_receipt_session_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_run public.verification_jobs_v2; v_notification_id uuid; v_event public.transaction_audit_events;
begin
  if p_decision not in ('APPROVED','CHANGES_REQUESTED') then raise exception 'Invalid decision'; end if;
  if p_delivery_status not in ('IN_APP','PENDING_EMAIL') then raise exception 'Invalid notification delivery status'; end if;
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  select * into v_run from public.verification_jobs_v2 where id=v_packet.run_id for update;
  if v_packet.decision is not null then raise exception 'Decision already recorded'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=now() then raise exception 'Review packet unavailable'; end if;
  if v_record.status<>'IN_REVIEW' or v_record.last_run_id is distinct from v_packet.run_id or v_record.criteria_revision<>v_packet.criteria_revision or v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_packet.criteria_revision then raise exception 'Review packet is stale'; end if;
  update public.review_packets_v2 set decision=p_decision,reviewer_name=p_reviewer_name,reviewer_email=p_reviewer_email,
    reviewer_note=nullif(p_reviewer_note,''),intent_confirmed=true,legal_terms_accepted=true,electronic_records_consent=true,notice_version=p_notice_version,
    actor_hash=p_actor_hash,country_code=p_country_code,decided_at=p_decided_at where id=p_packet_id;
  update public.transaction_records set status=case when p_decision='APPROVED' then 'APPROVED' else 'CHANGES_REQUESTED' end where id=v_packet.record_id;
  select * into v_event from public.append_transaction_event(v_packet.record_id,case when p_decision='APPROVED' then 'MILESTONE_APPROVED' else 'CHANGES_REQUESTED' end,'REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'runId',v_packet.run_id,'criteriaRevision',v_packet.criteria_revision,'snapshotSha256',v_packet.snapshot_sha256,
      'reviewerName',p_reviewer_name,'reviewerEmail',p_reviewer_email,'reviewerNote',p_reviewer_note,'intentConfirmed',true,'legalTermsAccepted',true,'electronicRecordsConsent',true,'noticeVersion',p_notice_version,'decidedAt',p_decided_at));
  update public.review_packets_v2 set receipt_sha256=v_event.event_hash,decision_event_hash=v_event.event_hash where id=p_packet_id;
  if v_record.owner_user_id is not null then
    insert into public.operator_notifications(owner_user_id,record_id,event_type,title,body,payload,delivery_status)
    values(v_record.owner_user_id,v_record.id,p_decision,
      case when p_decision='APPROVED' then v_record.milestone_title||' was approved' else v_record.client_name||' requested changes' end,
      p_reviewer_name||case when p_decision='APPROVED' then ' recorded approval. Open the agency dashboard for the retained record.' else ' requested changes. Open the agency dashboard for the retained record.' end,
      jsonb_build_object('packetId',v_packet.public_id,'reviewerEmail',p_reviewer_email,'decidedAt',p_decided_at),p_delivery_status)
    returning id into v_notification_id;
  end if;
  insert into public.receipt_sessions_v2(packet_id,session_hash,expires_at)
  values(v_packet.id,p_receipt_session_hash,p_receipt_session_expires_at);
  return jsonb_build_object('recordId',v_record.id,'notificationId',v_notification_id,'receiptSha256',v_event.event_hash,'auditSequence',v_event.sequence);
end; $$;

drop function if exists public.record_review_decision_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text);
drop function if exists public.purge_expired_transaction_record(uuid);
drop function if exists public.purge_expired_evidence_atomic(uuid[],uuid,timestamptz);

revoke all on function public.privacy_subject_record_ids(text) from public,anon,authenticated;
revoke all on function public.expire_stale_verification_jobs_atomic(timestamptz,text,integer) from public,anon,authenticated;
revoke all on function public.resolve_verification_job_atomic(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.begin_notification_delivery_atomic(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_notification_delivery_atomic(uuid,uuid,boolean,integer,text,timestamptz) from public,anon,authenticated;
revoke all on function public.retry_record_deletion_atomic(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.manage_beta_invite_atomic(text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.evidence_storage_usage_bytes() from public,anon,authenticated;
grant execute on function public.privacy_subject_record_ids(text) to service_role;
grant execute on function public.expire_stale_verification_jobs_atomic(timestamptz,text,integer) to service_role;
grant execute on function public.resolve_verification_job_atomic(uuid,text,text,timestamptz) to service_role;
grant execute on function public.begin_notification_delivery_atomic(uuid,timestamptz) to service_role;
grant execute on function public.complete_notification_delivery_atomic(uuid,uuid,boolean,integer,text,timestamptz) to service_role;
grant execute on function public.retry_record_deletion_atomic(uuid,text,timestamptz) to service_role;
grant execute on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz) to service_role;
grant execute on function public.manage_beta_invite_atomic(text,text,text,text,timestamptz) to service_role;
grant execute on function public.evidence_storage_usage_bytes() to service_role;
