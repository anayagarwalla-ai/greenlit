-- Independent beta-readiness follow-up: close review lifecycle, retention,
-- notification, and operator-action atomicity gaps without rewriting the
-- previously validated migration.

alter table public.evidence_artifacts_v2
  add column if not exists deletion_status text not null default 'ACTIVE',
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_error text;
alter table public.evidence_artifacts_v2 drop constraint if exists evidence_artifacts_v2_deletion_status_check;
alter table public.evidence_artifacts_v2 add constraint evidence_artifacts_v2_deletion_status_check
  check (deletion_status in ('ACTIVE','PENDING','FAILED'));

alter table public.transaction_records
  add column if not exists deletion_status text not null default 'ACTIVE',
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_error text,
  add column if not exists privacy_deletion_requested_at timestamptz,
  add column if not exists privacy_request_id uuid references public.privacy_requests_v2(id) on delete set null;
alter table public.transaction_records drop constraint if exists transaction_records_deletion_status_check;
alter table public.transaction_records add constraint transaction_records_deletion_status_check
  check (deletion_status in ('ACTIVE','PENDING','FAILED'));

create table if not exists public.privacy_record_amendments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.privacy_requests_v2(id) on delete restrict,
  record_id uuid not null references public.transaction_records(id) on delete restrict,
  field_name text not null check (field_name in ('agency_name','client_name','project_name','milestone_title')),
  previous_value text not null,
  corrected_value text not null,
  reason text not null,
  operator_email text not null,
  created_at timestamptz not null default now()
);
alter table public.privacy_record_amendments enable row level security;

-- A replacement review may be created after the previous packet was revoked
-- or expired, but an active packet still blocks duplicates.
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
  if v_record.status not in ('READY_FOR_REVIEW','IN_REVIEW') or v_record.last_run_id is distinct from p_run_id then raise exception 'Only the current reviewable run may be shared'; end if;
  if exists(select 1 from public.review_packets_v2 where record_id=p_record_id and decision is null and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'An active review link already exists'; end if;
  if v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_record.criteria_revision or p_criteria_revision<>v_record.criteria_revision then raise exception 'Run criteria revision is stale'; end if;
  if p_snapshot->>'recordId'<>p_record_id::text or p_snapshot#>>'{run,runId}'<>p_run_id::text
     or (p_snapshot->>'revision')::integer<>v_record.criteria_revision then raise exception 'Review snapshot does not match current record'; end if;
  update public.review_packets_v2 set revoked_at=coalesce(revoked_at,clock_timestamp()) where record_id=p_record_id and decision is null;
  insert into public.review_packets_v2(record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision)
  values(p_record_id,p_run_id,p_public_id,p_snapshot,p_snapshot_sha256,p_bearer_token_hash,p_expires_at,p_criteria_revision)
  returning id into v_packet_id;
  update public.transaction_records set status='IN_REVIEW' where id=p_record_id;
  perform public.append_transaction_event(p_record_id,'REVIEW_PACKET_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetPublicId',p_public_id,'runId',p_run_id,'criteriaRevision',p_criteria_revision,'snapshotSha256',p_snapshot_sha256,'expiresAt',p_expires_at));
  return v_packet_id;
end;
$$;

create or replace function public.manage_review_packet_atomic(
  p_packet_id uuid, p_owner_user_id uuid, p_action text, p_actor_hash text, p_now timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_expires_at timestamptz; v_hard_limit timestamptz;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Review packet owner mismatch'; end if;
  if v_packet.decision is not null then raise exception 'A final client decision cannot be changed'; end if;
  if p_action='revoke' then
    if v_packet.revoked_at is null then
      update public.review_packets_v2 set revoked_at=p_now where id=v_packet.id;
      if v_record.status='IN_REVIEW' and v_record.last_run_id=v_packet.run_id and v_record.criteria_revision=v_packet.criteria_revision
         and not exists(select 1 from public.review_packets_v2 where record_id=v_record.id and id<>v_packet.id and decision is null and revoked_at is null and expires_at>p_now) then
        update public.transaction_records set status='READY_FOR_REVIEW' where id=v_record.id;
      end if;
      perform public.append_transaction_event(v_record.id,'REVIEW_PACKET_REVOKED','OWNER',p_actor_hash,
        jsonb_build_object('packetId',v_packet.public_id,'revokedAt',p_now));
    end if;
    select * into v_record from public.transaction_records where id=v_record.id;
    return jsonb_build_object('revokedAt',coalesce(v_packet.revoked_at,p_now),'recordStatus',v_record.status);
  elsif p_action='extend' then
    if v_packet.revoked_at is not null then raise exception 'This review link is revoked'; end if;
    v_hard_limit := v_packet.created_at + interval '14 days';
    if v_hard_limit<=p_now then raise exception 'This review link reached its hard limit'; end if;
    v_expires_at := least(p_now + interval '72 hours',v_hard_limit);
    update public.review_packets_v2 set expires_at=v_expires_at where id=v_packet.id;
    perform public.append_transaction_event(v_record.id,'REVIEW_PACKET_EXTENDED','OWNER',p_actor_hash,
      jsonb_build_object('packetId',v_packet.public_id,'expiresAt',v_expires_at));
    return jsonb_build_object('expiresAt',v_expires_at);
  end if;
  raise exception 'Unknown review action';
end;
$$;

-- Decision, record transition, audit event, and durable notification are one
-- transaction. Webhook delivery remains asynchronous after commit.
create or replace function public.record_review_decision_with_notification_atomic(
  p_packet_id uuid, p_decision text, p_reviewer_name text, p_reviewer_email text,
  p_reviewer_note text, p_notice_version text, p_actor_hash text, p_country_code text,
  p_decided_at timestamptz, p_receipt_sha256 text, p_delivery_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_run public.verification_jobs_v2; v_notification_id uuid;
begin
  if p_decision not in ('APPROVED','CHANGES_REQUESTED') then raise exception 'Invalid decision'; end if;
  if p_delivery_status not in ('IN_APP','PENDING_EMAIL') then raise exception 'Invalid notification delivery status'; end if;
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  select * into v_run from public.verification_jobs_v2 where id=v_packet.run_id for update;
  if v_packet.decision is not null then raise exception 'Decision already recorded'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=now() then raise exception 'Review packet unavailable'; end if;
  if v_record.status<>'IN_REVIEW' or v_record.last_run_id is distinct from v_packet.run_id
     or v_record.criteria_revision<>v_packet.criteria_revision or v_run.status<>'COMPLETED'
     or v_run.criteria_revision<>v_packet.criteria_revision then raise exception 'Review packet is stale'; end if;
  update public.review_packets_v2 set decision=p_decision,reviewer_name=p_reviewer_name,
    reviewer_email=p_reviewer_email,reviewer_note=nullif(p_reviewer_note,''),intent_confirmed=true,
    electronic_records_consent=true,notice_version=p_notice_version,actor_hash=p_actor_hash,
    country_code=p_country_code,decided_at=p_decided_at,receipt_sha256=p_receipt_sha256 where id=p_packet_id;
  update public.transaction_records set status=case when p_decision='APPROVED' then 'APPROVED' else 'CHANGES_REQUESTED' end where id=v_packet.record_id;
  perform public.append_transaction_event(v_packet.record_id,case when p_decision='APPROVED' then 'MILESTONE_APPROVED' else 'CHANGES_REQUESTED' end,'REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'runId',v_packet.run_id,'criteriaRevision',v_packet.criteria_revision,
      'snapshotSha256',v_packet.snapshot_sha256,'receiptSha256',p_receipt_sha256,'reviewerName',p_reviewer_name,
      'reviewerEmail',p_reviewer_email,'reviewerNote',p_reviewer_note,'intentConfirmed',true,
      'electronicRecordsConsent',true,'noticeVersion',p_notice_version,'decidedAt',p_decided_at));
  if v_record.owner_user_id is not null then
    insert into public.operator_notifications(owner_user_id,record_id,event_type,title,body,payload,delivery_status)
    values(v_record.owner_user_id,v_record.id,p_decision,
      case when p_decision='APPROVED' then v_record.milestone_title||' was approved' else v_record.client_name||' requested changes' end,
      p_reviewer_name||case when p_decision='APPROVED' then ' recorded approval. Open the agency dashboard for the retained record.' else ' requested changes. Open the agency dashboard for the retained record.' end,
      jsonb_build_object('packetId',v_packet.public_id,'reviewerEmail',p_reviewer_email,'decidedAt',p_decided_at),p_delivery_status)
    returning id into v_notification_id;
  end if;
  return jsonb_build_object('recordId',v_record.id,'notificationId',v_notification_id);
end;
$$;

create or replace function public.update_feedback_status_atomic(p_id uuid,p_status text,p_operator_email text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.beta_feedback set status=p_status where id=p_id;
  if not found then raise exception 'Feedback not found'; end if;
  perform public.record_operator_action(p_operator_email,'UPDATE_FEEDBACK_STATUS','beta_feedback',p_id::text,jsonb_build_object('status',p_status));
  return true;
end; $$;

create or replace function public.update_privacy_request_atomic(
  p_id uuid,p_status text,p_assigned_to text,p_internal_notes text,p_identity_verified boolean,
  p_response_summary text,p_response_sent boolean,p_operator_email text,p_now timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_id for update;
  if v_request.id is null then raise exception 'Privacy request not found'; end if;
  if p_status in ('COMPLETED','DENIED') and (nullif(trim(p_response_summary),'') is null or not p_response_sent) then raise exception 'A final response summary and sent date are required'; end if;
  if p_status='COMPLETED' and not (p_identity_verified or v_request.identity_verified_at is not null) then raise exception 'Verify the requester before completing the request'; end if;
  update public.privacy_requests_v2 set status=p_status,assigned_to=nullif(trim(p_assigned_to),''),internal_notes=nullif(trim(p_internal_notes),''),
    identity_verified_at=case when p_identity_verified then coalesce(identity_verified_at,p_now) else identity_verified_at end,
    response_summary=nullif(trim(p_response_summary),''),response_sent_at=case when p_response_sent then coalesce(response_sent_at,p_now) else response_sent_at end,
    updated_at=p_now,completed_at=case when p_status in ('COMPLETED','DENIED') then p_now else null end where id=p_id;
  perform public.record_operator_action(p_operator_email,'UPDATE_PRIVACY_REQUEST','privacy_request',p_id::text,
    jsonb_build_object('status',p_status,'assignedTo',nullif(trim(p_assigned_to),''),'identityVerified',p_identity_verified,'responseSent',p_response_sent));
  return true;
end; $$;

create or replace function public.acknowledge_verification_job_atomic(p_id uuid,p_operator_email text,p_now timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.verification_jobs_v2 set acknowledged_at=p_now,acknowledged_by=p_operator_email where id=p_id;
  if not found then raise exception 'Verification job not found'; end if;
  perform public.record_operator_action(p_operator_email,'ACKNOWLEDGE_JOB','verification_job',p_id::text,'{}'::jsonb);
  return true;
end; $$;

create or replace function public.prepare_notification_retry_atomic(p_id uuid,p_operator_email text,p_now timestamptz)
returns public.operator_notifications language plpgsql security definer set search_path=public as $$
declare v_notification public.operator_notifications;
begin
  update public.operator_notifications set delivery_status='PENDING_EMAIL',delivery_attempts=0,delivery_error=null,last_delivery_at=p_now where id=p_id returning * into v_notification;
  if v_notification.id is null then raise exception 'Notification not found'; end if;
  perform public.record_operator_action(p_operator_email,'RETRY_NOTIFICATION_DELIVERY','operator_notification',p_id::text,'{}'::jsonb);
  return v_notification;
end; $$;

create or replace function public.set_privacy_legal_hold_atomic(p_request_id uuid,p_enabled boolean,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_request public.privacy_requests_v2; v_record record; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null then raise exception 'Privacy request not found'; end if;
  if v_request.identity_verified_at is null then raise exception 'Verify the requester before changing legal holds'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  for v_record in select r.* from public.transaction_records r join auth.users u on u.id=r.owner_user_id where lower(u.email)=lower(v_request.email) for update of r loop
    if p_enabled and (v_record.deletion_status='PENDING' or exists(select 1 from public.evidence_artifacts_v2 e where e.record_id=v_record.id and e.deletion_status='PENDING')) then raise exception 'Deletion is already in progress for a matched record'; end if;
    update public.transaction_records set legal_hold=p_enabled where id=v_record.id;
    update public.evidence_artifacts_v2 set legal_hold=p_enabled where record_id=v_record.id;
    perform public.append_transaction_event(v_record.id,case when p_enabled then 'LEGAL_HOLD_APPLIED' else 'LEGAL_HOLD_RELEASED' end,'SYSTEM',v_actor_hash,
      jsonb_build_object('privacyRequestId',v_request.public_id,'operatorEmailHash',v_actor_hash,'occurredAt',p_now));
    v_count:=v_count+1;
  end loop;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id and status not in ('COMPLETED','DENIED');
  perform public.record_operator_action(p_operator_email,case when p_enabled then 'APPLY_PRIVACY_LEGAL_HOLD' else 'RELEASE_PRIVACY_LEGAL_HOLD' end,'privacy_request',p_request_id::text,jsonb_build_object('recordCount',v_count));
  return v_count;
end; $$;

create or replace function public.record_privacy_correction_atomic(
  p_request_id uuid,p_record_id uuid,p_field_name text,p_corrected_value text,p_reason text,p_operator_email text,p_now timestamptz
) returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_request public.privacy_requests_v2; v_record public.transaction_records; v_previous text; v_id uuid; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  select r.* into v_record from public.transaction_records r join auth.users u on u.id=r.owner_user_id where r.id=p_record_id and lower(u.email)=lower(v_request.email) for update of r;
  if v_request.identity_verified_at is null or v_record.id is null then raise exception 'Verified requester record not found'; end if;
  v_previous:=case p_field_name when 'agency_name' then v_record.agency_name when 'client_name' then v_record.client_name when 'project_name' then v_record.project_name when 'milestone_title' then v_record.milestone_title else null end;
  if v_previous is null or nullif(trim(p_corrected_value),'') is null or nullif(trim(p_reason),'') is null then raise exception 'Invalid correction'; end if;
  insert into public.privacy_record_amendments(request_id,record_id,field_name,previous_value,corrected_value,reason,operator_email,created_at)
  values(p_request_id,p_record_id,p_field_name,v_previous,trim(p_corrected_value),trim(p_reason),p_operator_email,p_now) returning id into v_id;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  perform public.append_transaction_event(p_record_id,'PRIVACY_CORRECTION_RECORDED','SYSTEM',v_actor_hash,
    jsonb_build_object('amendmentId',v_id,'privacyRequestId',v_request.public_id,'field',p_field_name,'correctedValue',trim(p_corrected_value),'reason',trim(p_reason)));
  perform public.record_operator_action(p_operator_email,'RECORD_PRIVACY_CORRECTION','transaction_record',p_record_id::text,jsonb_build_object('requestId',p_request_id,'amendmentId',v_id,'field',p_field_name));
  return v_id;
end; $$;

create or replace function public.schedule_privacy_deletion_atomic(p_request_id uuid,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare v_request public.privacy_requests_v2; v_record record; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null or v_request.identity_verified_at is null then raise exception 'Verify the requester before scheduling deletion'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  for v_record in select r.* from public.transaction_records r join auth.users u on u.id=r.owner_user_id where lower(u.email)=lower(v_request.email) for update of r loop
    update public.transaction_records set privacy_deletion_requested_at=p_now,privacy_request_id=p_request_id where id=v_record.id;
    perform public.append_transaction_event(v_record.id,'PRIVACY_DELETION_SCHEDULED','SYSTEM',v_actor_hash,
      jsonb_build_object('privacyRequestId',v_request.public_id,'scheduledAt',p_now,'retentionUntil',v_record.retention_until));
    v_count:=v_count+1;
  end loop;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id;
  perform public.record_operator_action(p_operator_email,'SCHEDULE_PRIVACY_DELETION','privacy_request',p_request_id::text,jsonb_build_object('recordCount',v_count));
  return v_count;
end; $$;

-- Stage database state before touching object storage. Failed storage or final
-- DB operations remain visible and retryable instead of leaving a valid-looking
-- evidence row that points at a missing object.
create or replace function public.stage_expired_evidence_deletion(p_limit integer,p_now timestamptz)
returns table(id uuid,record_id uuid,storage_path text) language plpgsql security definer set search_path=public as $$
declare v_record_id uuid;
begin
  with candidates as (
    select e.id from public.evidence_artifacts_v2 e join public.transaction_records r on r.id=e.record_id
    where e.expires_at<=p_now and not e.legal_hold and not r.legal_hold and e.deletion_status in ('ACTIVE','FAILED') and r.deletion_status='ACTIVE'
    order by e.expires_at limit greatest(1,least(p_limit,500)) for update of e skip locked
  )
  update public.evidence_artifacts_v2 e set deletion_status='PENDING',deletion_requested_at=p_now,deletion_error=null where e.id in(select candidates.id from candidates);
  for v_record_id in select distinct e.record_id from public.evidence_artifacts_v2 e where e.deletion_status='PENDING' and e.deletion_requested_at=p_now loop
    perform public.append_transaction_event(v_record_id,'EVIDENCE_DELETION_STAGED','SYSTEM',null,jsonb_build_object('processedAt',p_now));
  end loop;
  return query select e.id,e.record_id,e.storage_path from public.evidence_artifacts_v2 e where e.deletion_status='PENDING' and e.deletion_requested_at=p_now order by e.record_id,e.id;
end; $$;

create or replace function public.finalize_evidence_deletion_atomic(p_ids uuid[],p_record_id uuid,p_processed_at timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer; v_record public.transaction_records;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.legal_hold then raise exception 'Record is unavailable or under legal hold'; end if;
  if exists(select 1 from public.evidence_artifacts_v2 where id=any(p_ids) and (record_id<>p_record_id or legal_hold or deletion_status<>'PENDING')) then raise exception 'Evidence deletion manifest changed'; end if;
  delete from public.evidence_artifacts_v2 where id=any(p_ids) and record_id=p_record_id and deletion_status='PENDING';
  get diagnostics v_count=row_count;
  if v_count>0 then perform public.append_transaction_event(p_record_id,'EVIDENCE_RETENTION_EXPIRED','SYSTEM',null,jsonb_build_object('deletedArtifactCount',v_count,'processedAt',p_processed_at)); end if;
  return v_count;
end; $$;

create or replace function public.fail_evidence_deletion_atomic(p_ids uuid[],p_record_id uuid,p_error text,p_processed_at timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.evidence_artifacts_v2 set deletion_status='FAILED',deletion_error=left(p_error,500) where id=any(p_ids) and record_id=p_record_id and deletion_status='PENDING';
  get diagnostics v_count=row_count;
  if v_count>0 then perform public.append_transaction_event(p_record_id,'EVIDENCE_DELETION_FAILED','SYSTEM',null,jsonb_build_object('artifactCount',v_count,'error',left(p_error,500),'processedAt',p_processed_at)); end if;
  return v_count;
end; $$;

create or replace function public.stage_expired_record_deletion(p_limit integer,p_now timestamptz)
returns table(id uuid) language sql security definer set search_path=public as $$
  with candidates as (
    select r.id from public.transaction_records r
    where r.retention_until<=p_now and not r.legal_hold and r.deletion_status in ('ACTIVE','FAILED')
      and not exists(select 1 from public.evidence_artifacts_v2 e where e.record_id=r.id and e.legal_hold)
    order by r.retention_until limit greatest(1,least(p_limit,50)) for update of r skip locked
  ),updated as (
    update public.transaction_records r set deletion_status='PENDING',deletion_requested_at=p_now,deletion_error=null where r.id in(select candidates.id from candidates) returning r.id
  ) select updated.id from updated;
$$;

create or replace function public.finalize_expired_record_deletion(p_record_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.deletion_status<>'PENDING' or v_record.legal_hold or v_record.retention_until>now() then return false; end if;
  if exists(select 1 from public.evidence_artifacts_v2 where record_id=p_record_id and legal_hold) then return false; end if;
  insert into public.operational_events(severity,service,event_type,record_id,details)
  values('INFO','retention','TRANSACTION_RECORD_PURGED',null,jsonb_build_object('recordId',p_record_id,'processedAt',clock_timestamp()));
  perform set_config('greenlit.retention_purge','on',true);
  delete from public.review_sessions_v2 where packet_id in(select id from public.review_packets_v2 where record_id=p_record_id);
  delete from public.review_packets_v2 where record_id=p_record_id;
  delete from public.privacy_record_amendments where record_id=p_record_id;
  delete from public.evidence_artifacts_v2 where record_id=p_record_id;
  delete from public.verification_jobs_v2 where record_id=p_record_id;
  delete from public.transaction_audit_events where record_id=p_record_id;
  delete from public.transaction_records where id=p_record_id;
  return true;
end; $$;

create or replace function public.fail_record_deletion_atomic(p_record_id uuid,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.transaction_records set deletion_status='FAILED',deletion_error=left(p_error,500) where id=p_record_id and deletion_status='PENDING';
  return found;
end; $$;

revoke all on function public.manage_review_packet_atomic(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.update_feedback_status_atomic(uuid,text,text) from public,anon,authenticated;
revoke all on function public.update_privacy_request_atomic(uuid,text,text,text,boolean,text,boolean,text,timestamptz) from public,anon,authenticated;
revoke all on function public.acknowledge_verification_job_atomic(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.prepare_notification_retry_atomic(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.set_privacy_legal_hold_atomic(uuid,boolean,text,timestamptz) from public,anon,authenticated;
revoke all on function public.record_privacy_correction_atomic(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.schedule_privacy_deletion_atomic(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.stage_expired_evidence_deletion(integer,timestamptz) from public,anon,authenticated;
revoke all on function public.finalize_evidence_deletion_atomic(uuid[],uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_evidence_deletion_atomic(uuid[],uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.stage_expired_record_deletion(integer,timestamptz) from public,anon,authenticated;
revoke all on function public.finalize_expired_record_deletion(uuid) from public,anon,authenticated;
revoke all on function public.fail_record_deletion_atomic(uuid,text) from public,anon,authenticated;

grant execute on function public.manage_review_packet_atomic(uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text) to service_role;
grant execute on function public.update_feedback_status_atomic(uuid,text,text) to service_role;
grant execute on function public.update_privacy_request_atomic(uuid,text,text,text,boolean,text,boolean,text,timestamptz) to service_role;
grant execute on function public.acknowledge_verification_job_atomic(uuid,text,timestamptz) to service_role;
grant execute on function public.prepare_notification_retry_atomic(uuid,text,timestamptz) to service_role;
grant execute on function public.set_privacy_legal_hold_atomic(uuid,boolean,text,timestamptz) to service_role;
grant execute on function public.record_privacy_correction_atomic(uuid,uuid,text,text,text,text,timestamptz) to service_role;
grant execute on function public.schedule_privacy_deletion_atomic(uuid,text,timestamptz) to service_role;
grant execute on function public.stage_expired_evidence_deletion(integer,timestamptz) to service_role;
grant execute on function public.finalize_evidence_deletion_atomic(uuid[],uuid,timestamptz) to service_role;
grant execute on function public.fail_evidence_deletion_atomic(uuid[],uuid,text,timestamptz) to service_role;
grant execute on function public.stage_expired_record_deletion(integer,timestamptz) to service_role;
grant execute on function public.finalize_expired_record_deletion(uuid) to service_role;
grant execute on function public.fail_record_deletion_atomic(uuid,text) to service_role;
