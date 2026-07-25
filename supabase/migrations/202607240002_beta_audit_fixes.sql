-- Close the remaining external-beta access and recovery gaps found in the
-- 2026-07-24 production audit.

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
  if p_expires_at<=now() or p_expires_at>now()+interval '30 days 1 minute' then raise exception 'Receipt-link expiry is invalid'; end if;

  -- A replacement capability is also the owner's revoke-all operation.
  -- This deliberately revokes redeemed browser sessions as well as unused
  -- links so a copied session cannot survive an incident response.
  update public.receipt_sessions_v2 set revoked_at=coalesce(revoked_at,clock_timestamp())
    where packet_id=v_packet.id and revoked_at is null;

  insert into public.receipt_sessions_v2(packet_id,session_hash,recipient_email,access_code_hash,expires_at)
    values(v_packet.id,p_token_hash,lower(trim(p_recipient_email)),p_access_code_hash,p_expires_at)
    returning id into v_session_id;
  perform public.append_transaction_event(v_record.id,'RECEIPT_LINK_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'grantId',v_session_id,'expiresAt',p_expires_at,
      'recipientEmail',lower(trim(p_recipient_email)),'accessProtection','LINK_AND_SEPARATE_CODE',
      'previousReceiptAccessRevoked',true));
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
  if p_session_expires_at<=p_redeemed_at or p_session_expires_at>p_redeemed_at+interval '30 days 1 minute' then
    raise exception 'Receipt session expiry is invalid';
  end if;
  v_session_expires_at:=least(v_grant.expires_at,p_redeemed_at+interval '30 days');
  update public.receipt_sessions_v2
    set session_hash=p_session_hash,access_code_hash=null,redeemed_at=p_redeemed_at,expires_at=v_session_expires_at
    where id=v_grant.id;
  return v_grant.id;
end;
$$;

create or replace function public.expire_owned_stale_verification_job_atomic(
  p_job_id uuid,p_owner_user_id uuid,p_stale_before timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2; v_record public.transaction_records;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Verification job not found'; end if;
  select * into v_record from public.transaction_records where id=v_job.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Verification owner mismatch'; end if;
  if v_job.status not in ('QUEUED','LEASED','RUNNING') then return false; end if;
  if coalesce(v_job.leased_at,v_job.started_at,v_job.created_at)>=p_stale_before then return false; end if;
  update public.verification_jobs_v2
    set status='EXPIRED',last_error='Verification exceeded the recovery window and was closed safely.',completed_at=clock_timestamp()
    where id=v_job.id;
  update public.transaction_records set status='READY',active_job_id=null
    where id=v_job.record_id and active_job_id=v_job.id;
  perform public.append_transaction_event(v_job.record_id,'VERIFICATION_EXPIRED','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'previousStatus',v_job.status,'staleBefore',p_stale_before,'recoveredOnOwnerPoll',true));
  return true;
end;
$$;

revoke all on function public.mint_receipt_session_secure_atomic(uuid,uuid,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke all on function public.redeem_receipt_session_secure_atomic(uuid,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.expire_owned_stale_verification_job_atomic(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.mint_receipt_session_secure_atomic(uuid,uuid,text,text,text,timestamptz,text) to service_role;
grant execute on function public.redeem_receipt_session_secure_atomic(uuid,text,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.expire_owned_stale_verification_job_atomic(uuid,uuid,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607240002','Receipt revocation, 30-day access consistency, and owner-poll stale-job recovery')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
