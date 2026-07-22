-- Privacy deletion must remain authoritative even for a legacy account that
-- was admitted from the environment allowlist before it had a beta_invites
-- row. The account-deletion queue creates a durable REMOVED tombstone, which
-- also activates the session-revocation trigger from 202607220004.

create or replace function public.tombstone_privacy_deleted_beta_access()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('PENDING','FAILED') then
    insert into public.beta_invites(email,status,adult_sponsor,invited_by,invited_at,removed_at,notes)
    values(lower(new.email),'REMOVED','Privacy deletion','system',new.requested_at,new.requested_at,
      'Account deletion queued through privacy request '||coalesce(new.request_id::text,'unknown'))
    on conflict(email) do update set status='REMOVED',removed_at=excluded.removed_at,notes=excluded.notes;
  end if;
  return new;
end;
$$;

drop trigger if exists privacy_account_deletions_tombstone_access on public.privacy_account_deletions;
create trigger privacy_account_deletions_tombstone_access
after insert or update of status,email on public.privacy_account_deletions
for each row execute function public.tombstone_privacy_deleted_beta_access();

insert into public.beta_invites(email,status,adult_sponsor,invited_by,invited_at,removed_at,notes)
select lower(d.email),'REMOVED','Privacy deletion','system',d.requested_at,d.requested_at,
  'Account deletion queued through privacy request '||coalesce(d.request_id::text,'unknown')
from public.privacy_account_deletions d where d.status in ('PENDING','FAILED')
on conflict(email) do update set status='REMOVED',removed_at=excluded.removed_at,notes=excluded.notes;

revoke all on function public.tombstone_privacy_deleted_beta_access() from public,anon,authenticated;

insert into public.app_schema_versions(version,description)
values('202607220005','Durable removed-invite tombstones for privacy-deleted legacy accounts')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
