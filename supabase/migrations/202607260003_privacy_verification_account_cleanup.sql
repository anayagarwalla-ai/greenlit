-- Privacy-request email verification may need a temporary Supabase Auth user so
-- the magic-link exchange can prove control of the email address. Keep cleanup
-- separate from user-requested account deletion: the latter intentionally
-- creates a durable beta-access tombstone, while verification cleanup must not.

create table if not exists public.privacy_verification_account_cleanups (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.privacy_requests_v2(id) on delete set null,
  auth_user_id uuid not null,
  email text not null,
  status text not null default 'PENDING' check (status in ('PENDING','FAILED','COMPLETED')),
  disposition text check (disposition in ('DELETED','ALREADY_ABSENT','PRESERVED_ACTIVE_ACCOUNT')),
  attempts integer not null default 0,
  last_error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  retention_until timestamptz not null default (now() + interval '4 years')
);

alter table public.privacy_verification_account_cleanups enable row level security;
revoke all on table public.privacy_verification_account_cleanups from public,anon,authenticated;

create unique index if not exists one_open_privacy_verification_account_cleanup
  on public.privacy_verification_account_cleanups(auth_user_id)
  where status in ('PENDING','FAILED');
create index if not exists privacy_verification_account_cleanup_status_idx
  on public.privacy_verification_account_cleanups(status,requested_at);
create index if not exists privacy_verification_account_cleanup_retention_idx
  on public.privacy_verification_account_cleanups(retention_until);

-- The five-argument implementation from 202607240001 cannot record whether
-- the Auth account exists only for verification. Remove the overload so every
-- caller must use the cleanup-aware contract below.
drop function if exists public.complete_privacy_email_verification_atomic(
  text,text,text,uuid,timestamptz
);

create or replace function public.complete_privacy_email_verification_atomic(
  p_public_id text,
  p_verification_token_hash text,
  p_email text,
  p_auth_user_id uuid,
  p_verified_at timestamptz,
  p_cleanup_verification_account boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.privacy_requests_v2;
  v_cleanup_id uuid;
begin
  select * into v_request
    from public.privacy_requests_v2
    where public_id=p_public_id
    for update;
  if v_request.id is null or v_request.identity_verified_at is not null then
    raise exception 'Privacy request unavailable';
  end if;
  if lower(v_request.email) is distinct from lower(trim(p_email))
     or v_request.verification_token_hash is distinct from p_verification_token_hash
     or v_request.verification_expires_at<=p_verified_at then
    raise exception 'Privacy verification is invalid or expired';
  end if;

  update public.privacy_requests_v2
    set identity_verified_at=p_verified_at,
      verification_method='SUPABASE_EMAIL_OTP',
      verified_auth_user_id=p_auth_user_id,
      verification_token_hash=null,
      verification_expires_at=null,
      status=case when status='RECEIVED' then 'VERIFYING' else status end,
      updated_at=p_verified_at
    where id=v_request.id;

  if p_cleanup_verification_account then
    insert into public.privacy_verification_account_cleanups(
      request_id,auth_user_id,email,status,requested_at
    ) values(
      v_request.id,p_auth_user_id,lower(trim(p_email)),'PENDING',p_verified_at
    )
    on conflict(auth_user_id) where status in ('PENDING','FAILED')
    do update set
      request_id=excluded.request_id,
      email=excluded.email,
      status='PENDING',
      disposition=null,
      last_error=null,
      requested_at=excluded.requested_at,
      completed_at=null
    returning id into v_cleanup_id;
  end if;

  return jsonb_build_object('requestId',v_request.id,'cleanupId',v_cleanup_id);
end;
$$;

revoke all on function public.complete_privacy_email_verification_atomic(text,text,text,uuid,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.complete_privacy_email_verification_atomic(text,text,text,uuid,timestamptz,boolean)
  to service_role;

insert into public.app_schema_versions(version,description)
values('202607260003','Durable cleanup for privacy-verification-only Auth accounts')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
