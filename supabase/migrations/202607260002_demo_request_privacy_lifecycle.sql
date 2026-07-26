-- Give public demo/design-partner requests the same explicit consent,
-- retention, operator-audit, and verified privacy-deletion lifecycle as the
-- rest of the closed beta.

alter table public.demo_requests
  add column if not exists privacy_notice_version text,
  add column if not exists contact_consent boolean,
  add column if not exists adult_business_use_attested boolean,
  add column if not exists consented_at timestamptz,
  add column if not exists retention_until timestamptz;

update public.demo_requests
set privacy_notice_version = coalesce(privacy_notice_version, '2026-07-20'),
    contact_consent = coalesce(contact_consent, true),
    adult_business_use_attested = coalesce(adult_business_use_attested, true),
    consented_at = coalesce(consented_at, created_at),
    retention_until = coalesce(retention_until, created_at + interval '12 months');

alter table public.demo_requests
  alter column privacy_notice_version set not null,
  alter column contact_consent set not null,
  alter column adult_business_use_attested set not null,
  alter column consented_at set not null,
  alter column retention_until set not null,
  alter column retention_until set default (clock_timestamp() + interval '12 months');

alter table public.demo_requests
  drop constraint if exists demo_requests_privacy_notice_version_check,
  drop constraint if exists demo_requests_consent_check,
  drop constraint if exists demo_requests_retention_check;
alter table public.demo_requests
  add constraint demo_requests_privacy_notice_version_check
    check (char_length(privacy_notice_version) between 1 and 80),
  add constraint demo_requests_consent_check
    check (contact_consent and adult_business_use_attested),
  add constraint demo_requests_retention_check
    check (retention_until >= created_at);

create index if not exists demo_requests_retention_idx
  on public.demo_requests(retention_until, id);

-- The application must use the atomic RPCs below so that intake cannot be
-- committed without its operator alert and status changes cannot be committed
-- without their operator audit record.
revoke insert, update on public.demo_requests from service_role;
grant select, delete on public.demo_requests to service_role;

create or replace function public.create_demo_request_atomic(
  p_public_id text,
  p_name text,
  p_email text,
  p_agency_name text,
  p_role text,
  p_agency_size text,
  p_location text,
  p_monthly_milestone_volume text,
  p_approval_delay_days integer,
  p_staging_model text,
  p_desired_next_step text,
  p_current_process text,
  p_source_path text,
  p_actor_hash text,
  p_privacy_notice_version text,
  p_contact_consent boolean,
  p_adult_business_use_attested boolean,
  p_consented_at timestamptz,
  p_notification_delivery_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.demo_requests;
  v_notification_id uuid;
  v_created_at timestamptz := clock_timestamp();
begin
  if p_contact_consent is distinct from true
     or p_adult_business_use_attested is distinct from true then
    raise exception 'Demo-request consent and adult business-use attestation are required';
  end if;
  if p_notification_delivery_status not in ('IN_APP', 'PENDING_EMAIL') then
    raise exception 'Demo-request notification delivery status is invalid';
  end if;
  if p_consented_at is null
     or p_consented_at > v_created_at + interval '5 minutes'
     or p_consented_at < v_created_at - interval '1 day' then
    raise exception 'Demo-request consent time is invalid';
  end if;

  insert into public.demo_requests(
    public_id,
    name,
    email,
    agency_name,
    role,
    agency_size,
    location,
    monthly_milestone_volume,
    approval_delay_days,
    staging_model,
    desired_next_step,
    current_process,
    source_path,
    actor_hash,
    privacy_notice_version,
    contact_consent,
    adult_business_use_attested,
    consented_at,
    retention_until,
    created_at,
    updated_at
  ) values (
    trim(p_public_id),
    trim(p_name),
    lower(trim(p_email)),
    trim(p_agency_name),
    trim(p_role),
    p_agency_size,
    trim(p_location),
    p_monthly_milestone_volume,
    p_approval_delay_days,
    p_staging_model,
    p_desired_next_step,
    trim(p_current_process),
    p_source_path,
    p_actor_hash,
    trim(p_privacy_notice_version),
    true,
    true,
    p_consented_at,
    v_created_at + interval '12 months',
    v_created_at,
    v_created_at
  )
  returning * into v_request;

  insert into public.operator_notifications(
    owner_user_id,
    record_id,
    event_type,
    title,
    body,
    payload,
    delivery_status
  ) values (
    null,
    null,
    'DEMO_REQUEST_RECEIVED',
    'New company-demo request',
    'A new company-demo request is ready for operator qualification.',
    jsonb_build_object('requestId', v_request.public_id),
    p_notification_delivery_status
  )
  returning id into v_notification_id;

  return jsonb_build_object(
    'id', v_request.id,
    'requestId', v_request.public_id,
    'notificationId', v_notification_id,
    'retentionUntil', v_request.retention_until
  );
end;
$$;

create or replace function public.update_demo_request_atomic(
  p_id uuid,
  p_status text,
  p_assigned_to text,
  p_internal_notes text,
  p_operator_email text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous public.demo_requests;
  v_request public.demo_requests;
begin
  if p_status not in ('NEW', 'QUALIFYING', 'BOOKED', 'CLOSED', 'DECLINED') then
    raise exception 'Demo-request status is invalid';
  end if;
  if char_length(trim(coalesce(p_assigned_to, ''))) > 160
     or char_length(trim(coalesce(p_internal_notes, ''))) > 4000 then
    raise exception 'Demo-request operator fields are too long';
  end if;
  if trim(coalesce(p_operator_email, '')) = '' then
    raise exception 'Demo-request operator identity is required';
  end if;

  select * into v_previous
  from public.demo_requests
  where id = p_id
  for update;
  if v_previous.id is null then
    raise exception 'Demo request was not found';
  end if;

  update public.demo_requests
  set status = p_status,
      assigned_to = nullif(trim(coalesce(p_assigned_to, '')), ''),
      internal_notes = nullif(trim(coalesce(p_internal_notes, '')), ''),
      updated_at = p_now
  where id = p_id
  returning * into v_request;

  perform public.record_operator_action(
    lower(trim(p_operator_email)),
    'UPDATE_DEMO_REQUEST',
    'demo_request',
    v_request.id::text,
    jsonb_build_object(
      'publicId', v_request.public_id,
      'previousStatus', v_previous.status,
      'status', v_request.status,
      'assigned', v_request.assigned_to is not null,
      'notesPresent', v_request.internal_notes is not null,
      'updatedAt', p_now
    )
  );

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'assigned_to', v_request.assigned_to,
    'internal_notes', v_request.internal_notes,
    'updated_at', v_request.updated_at
  );
end;
$$;

create or replace function public.purge_expired_demo_requests_atomic(
  p_now timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  with candidates as (
    select id
    from public.demo_requests
    where retention_until <= p_now
    order by retention_until, id
    limit greatest(1, least(coalesce(p_limit, 500), 500))
    for update skip locked
  ), deleted as (
    delete from public.demo_requests request
    using candidates
    where request.id = candidates.id
    returning request.id
  )
  select count(*)::integer into v_deleted from deleted;
  return v_deleted;
end;
$$;

create or replace function public.purge_demo_request_subject_atomic(
  p_request_id uuid,
  p_operator_email text,
  p_now timestamptz
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privacy_request public.privacy_requests_v2;
  v_deleted integer := 0;
begin
  select * into v_privacy_request
  from public.privacy_requests_v2
  where id = p_request_id
  for update;
  if v_privacy_request.id is null
     or v_privacy_request.request_type <> 'DELETION'
     or v_privacy_request.identity_verified_at is null then
    raise exception 'A verified deletion request is required';
  end if;

  delete from public.demo_requests
  where email = lower(trim(v_privacy_request.email));
  get diagnostics v_deleted = row_count;

  perform public.record_operator_action(
    lower(trim(p_operator_email)),
    'PURGE_DEMO_REQUEST_SUBJECT',
    'privacy_request',
    p_request_id::text,
    jsonb_build_object(
      'privacyRequestId', v_privacy_request.public_id,
      'deletedDemoRequests', v_deleted,
      'purgedAt', p_now
    )
  );
  return v_deleted;
end;
$$;

-- Keep the established account/record deletion state machine intact and add
-- demo-request deletion in the same database transaction.
create or replace function public.schedule_privacy_deletion_with_demo_atomic(
  p_request_id uuid,
  p_operator_email text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_count integer;
  v_demo_request_count integer;
begin
  v_record_count := public.schedule_privacy_deletion_atomic(
    p_request_id,
    p_operator_email,
    p_now
  );
  v_demo_request_count := public.purge_demo_request_subject_atomic(
    p_request_id,
    p_operator_email,
    p_now
  );
  return jsonb_build_object(
    'recordCount', v_record_count,
    'demoRequestCount', v_demo_request_count
  );
end;
$$;

revoke all on function public.create_demo_request_atomic(
  text,text,text,text,text,text,text,text,integer,text,text,text,text,text,text,boolean,boolean,timestamptz,text
) from public, anon, authenticated;
revoke all on function public.update_demo_request_atomic(
  uuid,text,text,text,text,timestamptz
) from public, anon, authenticated;
revoke all on function public.purge_expired_demo_requests_atomic(
  timestamptz,integer
) from public, anon, authenticated;
revoke all on function public.purge_demo_request_subject_atomic(
  uuid,text,timestamptz
) from public, anon, authenticated;
revoke all on function public.schedule_privacy_deletion_with_demo_atomic(
  uuid,text,timestamptz
) from public, anon, authenticated;

grant execute on function public.create_demo_request_atomic(
  text,text,text,text,text,text,text,text,integer,text,text,text,text,text,text,boolean,boolean,timestamptz,text
) to service_role;
grant execute on function public.update_demo_request_atomic(
  uuid,text,text,text,text,timestamptz
) to service_role;
grant execute on function public.purge_expired_demo_requests_atomic(
  timestamptz,integer
) to service_role;
grant execute on function public.purge_demo_request_subject_atomic(
  uuid,text,timestamptz
) to service_role;
grant execute on function public.schedule_privacy_deletion_with_demo_atomic(
  uuid,text,timestamptz
) to service_role;

insert into public.app_schema_versions(version, description)
values (
  '202607260002',
  'Demo-request consent, retention, operator notification, audit, and privacy deletion lifecycle'
)
on conflict(version) do update
set description = excluded.description,
    applied_at = clock_timestamp();
