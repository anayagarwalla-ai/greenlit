-- Persist failed Stripe callbacks so readiness can see them, while allowing
-- Stripe's signed retry of the exact same event to reclaim only that failed
-- receipt. Successfully processed/ignored event IDs remain immutable.

create or replace function public.reclaim_failed_stripe_webhook_retry()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.stripe_webhook_events;
begin
  if new.status<>'PROCESSED' then
    return new;
  end if;

  select * into v_existing
    from public.stripe_webhook_events
    where event_id=new.event_id
    for update;
  if v_existing.event_id is null or v_existing.status<>'FAILED' then
    return new;
  end if;
  if v_existing.payload_sha256 is distinct from new.payload_sha256
     or v_existing.event_type is distinct from new.event_type
     or v_existing.stripe_account_id is distinct from new.stripe_account_id
     or v_existing.object_id is distinct from new.object_id
     or v_existing.livemode is distinct from new.livemode then
    raise exception 'Stripe webhook retry does not match the failed event receipt';
  end if;

  delete from public.stripe_webhook_events
    where event_id=new.event_id and status='FAILED';
  return new;
end;
$$;

drop trigger if exists stripe_webhook_failed_retry_reclaim
  on public.stripe_webhook_events;
create trigger stripe_webhook_failed_retry_reclaim
before insert on public.stripe_webhook_events
for each row
execute function public.reclaim_failed_stripe_webhook_retry();

revoke all on function public.reclaim_failed_stripe_webhook_retry()
  from public,anon,authenticated;

insert into public.app_schema_versions(version,description)
values('202607260007','Durable failed Stripe webhook receipts with exact-event retry reclamation')
on conflict(version) do update
set description=excluded.description,applied_at=clock_timestamp();
