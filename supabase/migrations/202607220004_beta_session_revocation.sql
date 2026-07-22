-- A removed beta invitation is the authoritative access boundary. Revoke the
-- corresponding refresh sessions in the same database transaction instead
-- of incorrectly passing a user UUID to Supabase's JWT-based signOut API.

create or replace function public.revoke_removed_beta_sessions()
returns trigger language plpgsql security definer set search_path=public,auth as $$
begin
  if new.status='REMOVED' and (tg_op='INSERT' or old.status is distinct from new.status or old.email is distinct from new.email) then
    delete from auth.sessions s
    using auth.users u
    where s.user_id=u.id and lower(u.email)=lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists beta_invites_revoke_sessions on public.beta_invites;
create trigger beta_invites_revoke_sessions
after insert or update of status,email on public.beta_invites
for each row execute function public.revoke_removed_beta_sessions();

revoke all on function public.revoke_removed_beta_sessions() from public,anon,authenticated;

insert into public.app_schema_versions(version,description)
values('202607220004','Atomic refresh-session revocation when beta access is removed')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
