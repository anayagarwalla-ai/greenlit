-- Security hardening for external review/receipt capabilities and privacy
-- identity verification. Legacy bearer-only review links are deliberately
-- revoked because an intended recipient cannot be reconstructed safely.

alter table public.review_packets_v2
  alter column bearer_token_hash drop not null,
  add column if not exists intended_reviewer_email text,
  add column if not exists access_code_hash text,
  add column if not exists redeemed_at timestamptz;

alter table public.review_sessions_v2
  add column if not exists revoked_at timestamptz;

alter table public.receipt_sessions_v2
  add column if not exists recipient_email text,
  add column if not exists access_code_hash text,
  add column if not exists redeemed_at timestamptz,
  add column if not exists revoked_at timestamptz;

alter table public.privacy_requests_v2
  add column if not exists verification_token_hash text,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verification_method text,
  add column if not exists verified_auth_user_id uuid references auth.users(id) on delete set null;

update public.review_packets_v2
set revoked_at=coalesce(revoked_at,clock_timestamp())
where decision is null
  and (intended_reviewer_email is null or access_code_hash is null);

update public.review_sessions_v2 s
set revoked_at=coalesce(s.revoked_at,clock_timestamp())
where exists(
  select 1 from public.review_packets_v2 p
  where p.id=s.packet_id and p.revoked_at is not null
);

-- Existing receipt rows were bearer-only capabilities. Their intended
-- recipient cannot be reconstructed, so fail closed and require the owner to
-- mint a new recipient-bound grant.
update public.receipt_sessions_v2
set revoked_at=coalesce(revoked_at,clock_timestamp());

create index if not exists review_packets_v2_recipient_idx
  on public.review_packets_v2(lower(intended_reviewer_email),expires_at);
create index if not exists receipt_sessions_v2_active_idx
  on public.receipt_sessions_v2(packet_id,expires_at)
  where revoked_at is null;
create unique index if not exists privacy_requests_v2_verification_token_idx
  on public.privacy_requests_v2(verification_token_hash)
  where verification_token_hash is not null;

create or replace function public.create_review_packet_secure_atomic(
  p_record_id uuid,p_run_id uuid,p_public_id text,p_snapshot jsonb,p_snapshot_sha256 text,
  p_bearer_token_hash text,p_access_code_hash text,p_intended_reviewer_email text,
  p_expires_at timestamptz,p_actor_hash text,p_criteria_revision integer
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_packet_id uuid; v_record public.transaction_records; v_run public.verification_jobs_v2; v_owner_user_id uuid;
begin
  if nullif(trim(p_bearer_token_hash),'') is null or nullif(trim(p_access_code_hash),'') is null
     or lower(trim(p_intended_reviewer_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid intended reviewer and both review secrets are required';
  end if;
  select owner_user_id into v_owner_user_id from public.transaction_records where id=p_record_id;
  if v_owner_user_id is null or not public.owner_beta_active_locked(v_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_record from public.transaction_records where id=p_record_id for update;
  select * into v_run from public.verification_jobs_v2 where id=p_run_id and record_id=p_record_id for update;
  if v_record.id is null or v_run.id is null or v_record.owner_user_id is distinct from v_owner_user_id then raise exception 'Record or run not found'; end if;
  if v_record.status not in ('READY_FOR_REVIEW','IN_REVIEW') or v_record.last_run_id is distinct from p_run_id then raise exception 'Only the current reviewable run may be shared'; end if;
  if exists(select 1 from public.review_packets_v2 where record_id=p_record_id and decision is null and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'An active review link already exists'; end if;
  if v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_record.criteria_revision or p_criteria_revision<>v_record.criteria_revision then raise exception 'Run criteria revision is stale'; end if;
  if p_snapshot->>'recordId'<>p_record_id::text or p_snapshot#>>'{run,runId}'<>p_run_id::text or (p_snapshot->>'revision')::integer<>v_record.criteria_revision then raise exception 'Review snapshot does not match current record'; end if;
  if lower(p_snapshot->>'intendedReviewerEmail')<>lower(trim(p_intended_reviewer_email)) then raise exception 'Review recipient does not match the immutable snapshot'; end if;
  update public.review_packets_v2 set revoked_at=coalesce(revoked_at,clock_timestamp()) where record_id=p_record_id and decision is null;
  insert into public.review_packets_v2(
    record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,access_code_hash,
    intended_reviewer_email,expires_at,criteria_revision
  ) values(
    p_record_id,p_run_id,p_public_id,p_snapshot,p_snapshot_sha256,p_bearer_token_hash,p_access_code_hash,
    lower(trim(p_intended_reviewer_email)),p_expires_at,p_criteria_revision
  ) returning id into v_packet_id;
  update public.transaction_records set status='IN_REVIEW' where id=p_record_id;
  perform public.append_transaction_event(p_record_id,'REVIEW_PACKET_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetPublicId',p_public_id,'runId',p_run_id,'criteriaRevision',p_criteria_revision,
      'snapshotSha256',p_snapshot_sha256,'expiresAt',p_expires_at,
      'intendedReviewerEmail',lower(trim(p_intended_reviewer_email)),'accessProtection','LINK_AND_SEPARATE_CODE'));
  return v_packet_id;
end;
$$;

create or replace function public.redeem_review_packet_secure_atomic(
  p_packet_id uuid,p_bearer_token_hash text,p_access_code_hash text,p_reviewer_email text,
  p_session_hash text,p_session_expires_at timestamptz,p_actor_hash text,
  p_snapshot_sha256 text,p_redeemed_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_session_id uuid;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=p_redeemed_at then raise exception 'Review packet unavailable'; end if;
  if v_packet.decision is not null then raise exception 'The review is already final; request a receipt link'; end if;
  if v_packet.redeemed_at is not null or v_packet.bearer_token_hash is null then raise exception 'Review link already redeemed'; end if;
  if v_packet.bearer_token_hash is distinct from p_bearer_token_hash
     or v_packet.access_code_hash is distinct from p_access_code_hash
     or lower(v_packet.intended_reviewer_email) is distinct from lower(trim(p_reviewer_email)) then
    raise exception 'Review credentials do not match';
  end if;
  if v_packet.snapshot_sha256 is distinct from p_snapshot_sha256 then raise exception 'Review snapshot changed before redemption'; end if;
  if p_session_expires_at<=p_redeemed_at or p_session_expires_at>least(v_packet.expires_at,p_redeemed_at+interval '2 hours') then
    raise exception 'Review session expiry is invalid';
  end if;
  update public.review_packets_v2 set redeemed_at=p_redeemed_at,bearer_token_hash=null,access_code_hash=null where id=v_packet.id;
  update public.review_sessions_v2 set revoked_at=coalesce(revoked_at,p_redeemed_at) where packet_id=v_packet.id and revoked_at is null;
  insert into public.review_sessions_v2(packet_id,session_hash,expires_at) values(v_packet.id,p_session_hash,p_session_expires_at) returning id into v_session_id;
  perform public.append_transaction_event(v_packet.record_id,'REVIEW_LINK_REDEEMED','REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'snapshotSha256',v_packet.snapshot_sha256,
      'redeemedAt',p_redeemed_at,'recipientMatched',true,'oneTimeLinkConsumed',true));
  return v_session_id;
end;
$$;

create or replace function public.mint_receipt_session_secure_atomic(
  p_packet_id uuid,p_owner_user_id uuid,p_token_hash text,p_access_code_hash text,
  p_recipient_email text,p_expires_at timestamptz,p_actor_hash text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_session_id uuid;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null or v_packet.decision<>'APPROVED' then raise exception 'An approved decision is required'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id or not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'Receipt owner mismatch or inactive account'; end if;
  if lower(trim(p_recipient_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or nullif(trim(p_token_hash),'') is null or nullif(trim(p_access_code_hash),'') is null then raise exception 'Receipt recipient and access credentials are required'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '24 hours' then raise exception 'Receipt-link expiry is invalid'; end if;
  update public.receipt_sessions_v2 set revoked_at=coalesce(revoked_at,clock_timestamp())
    where packet_id=v_packet.id and revoked_at is null and redeemed_at is null;
  insert into public.receipt_sessions_v2(packet_id,session_hash,recipient_email,access_code_hash,expires_at)
    values(v_packet.id,p_token_hash,lower(trim(p_recipient_email)),p_access_code_hash,p_expires_at)
    returning id into v_session_id;
  perform public.append_transaction_event(v_record.id,'RECEIPT_LINK_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'grantId',v_session_id,'expiresAt',p_expires_at,
      'recipientEmail',lower(trim(p_recipient_email)),'accessProtection','LINK_AND_SEPARATE_CODE'));
  return v_session_id;
end;
$$;

create or replace function public.redeem_receipt_session_secure_atomic(
  p_packet_id uuid,p_token_hash text,p_access_code_hash text,p_recipient_email text,
  p_session_hash text,p_session_expires_at timestamptz,p_redeemed_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_grant public.receipt_sessions_v2; v_decision text; v_session_expires_at timestamptz;
begin
  select decision into v_decision from public.review_packets_v2 where id=p_packet_id;
  if v_decision is distinct from 'APPROVED' then raise exception 'The final receipt is unavailable'; end if;
  select * into v_grant from public.receipt_sessions_v2
    where packet_id=p_packet_id and session_hash=p_token_hash for update;
  if v_grant.id is null or v_grant.revoked_at is not null or v_grant.expires_at<=p_redeemed_at
     or v_grant.redeemed_at is not null then raise exception 'Receipt link unavailable'; end if;
  if v_grant.access_code_hash is distinct from p_access_code_hash
     or lower(v_grant.recipient_email) is distinct from lower(trim(p_recipient_email)) then
    raise exception 'Receipt credentials do not match';
  end if;
  if p_session_expires_at<=p_redeemed_at then
    raise exception 'Receipt session expiry is invalid';
  end if;
  v_session_expires_at:=least(v_grant.expires_at,p_redeemed_at+interval '24 hours');
  update public.receipt_sessions_v2
    set session_hash=p_session_hash,access_code_hash=null,redeemed_at=p_redeemed_at,expires_at=v_session_expires_at
    where id=v_grant.id;
  return v_grant.id;
end;
$$;

create or replace function public.complete_privacy_email_verification_atomic(
  p_public_id text,p_verification_token_hash text,p_email text,p_auth_user_id uuid,p_verified_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2;
begin
  select * into v_request from public.privacy_requests_v2 where public_id=p_public_id for update;
  if v_request.id is null or v_request.identity_verified_at is not null then raise exception 'Privacy request unavailable'; end if;
  if lower(v_request.email) is distinct from lower(trim(p_email))
     or v_request.verification_token_hash is distinct from p_verification_token_hash
     or v_request.verification_expires_at<=p_verified_at then raise exception 'Privacy verification is invalid or expired'; end if;
  update public.privacy_requests_v2
    set identity_verified_at=p_verified_at,verification_method='SUPABASE_EMAIL_OTP',
      verified_auth_user_id=p_auth_user_id,verification_token_hash=null,verification_expires_at=null,
      status=case when status='RECEIVED' then 'VERIFYING' else status end,updated_at=p_verified_at
    where id=v_request.id;
  return v_request.id;
end;
$$;

create or replace function public.enforce_review_recipient_identity()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.decision is not null and old.decision is null then
    if new.intended_reviewer_email is null
       or lower(new.reviewer_email) is distinct from lower(new.intended_reviewer_email) then
      raise exception 'Reviewer email does not match the intended recipient';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists review_recipient_identity_guard on public.review_packets_v2;
create trigger review_recipient_identity_guard
before update on public.review_packets_v2
for each row execute function public.enforce_review_recipient_identity();

revoke all on function public.create_review_packet_atomic(uuid,uuid,text,jsonb,text,text,timestamptz,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.redeem_review_packet_atomic(uuid,text,timestamptz,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.mint_receipt_session_atomic(uuid,uuid,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.create_review_packet_secure_atomic(uuid,uuid,text,jsonb,text,text,text,text,timestamptz,text,integer) from public,anon,authenticated;
revoke all on function public.redeem_review_packet_secure_atomic(uuid,text,text,text,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.mint_receipt_session_secure_atomic(uuid,uuid,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.redeem_receipt_session_secure_atomic(uuid,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_privacy_email_verification_atomic(text,text,text,uuid,timestamptz) from public,anon,authenticated;

grant execute on function public.create_review_packet_secure_atomic(uuid,uuid,text,jsonb,text,text,text,text,timestamptz,text,integer) to service_role;
grant execute on function public.redeem_review_packet_secure_atomic(uuid,text,text,text,text,timestamptz,text,text,timestamptz) to service_role;
grant execute on function public.mint_receipt_session_secure_atomic(uuid,uuid,text,text,text,timestamptz,text) to service_role;
grant execute on function public.redeem_receipt_session_secure_atomic(uuid,text,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.complete_privacy_email_verification_atomic(text,text,text,uuid,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607240001','One-time recipient-bound review and receipt grants plus verified privacy identity')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
