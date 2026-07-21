-- Make the application schema version independently queryable and repair
-- decision receipts created before decision_event_hash was introduced.

create table if not exists public.app_schema_versions (
  version text primary key check (version ~ '^[0-9]{12}$'),
  description text not null,
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.app_schema_versions enable row level security;
revoke all on table public.app_schema_versions from anon, authenticated;

with legacy_receipts as (
  select p.id, min(e.event_hash) as event_hash
  from public.review_packets_v2 p
  join public.transaction_audit_events e
    on e.record_id = p.record_id
   and e.payload->>'packetId' = p.public_id
   and e.event_type = case
     when p.decision = 'APPROVED' then 'MILESTONE_APPROVED'
     else 'CHANGES_REQUESTED'
   end
  where p.decision is not null
    and p.decision_event_hash is null
  group by p.id
  having count(*) = 1
)
update public.review_packets_v2 p
set receipt_sha256 = legacy_receipts.event_hash,
    decision_event_hash = legacy_receipts.event_hash
from legacy_receipts
where p.id = legacy_receipts.id;

do $$
begin
  if exists (
    select 1
    from public.review_packets_v2
    where decision is not null
      and (
        receipt_sha256 is null
        or decision_event_hash is null
        or receipt_sha256 <> decision_event_hash
      )
  ) then
    raise exception 'A decided review packet could not be bound to exactly one decision audit event';
  end if;
end $$;

insert into public.app_schema_versions(version, description)
values ('202607210004', 'Legacy receipt audit-event backfill and application schema ledger')
on conflict (version) do update set description = excluded.description;
