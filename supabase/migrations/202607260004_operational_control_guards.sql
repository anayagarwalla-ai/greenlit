-- Close the check-then-write race between API pause checks and durable work
-- creation. Environment pauses remain enforced by the application; database
-- pauses are also authoritative inside the same transaction as each insert or
-- transition that starts high-impact work.

create or replace function public.enforce_database_operational_control()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_feature text:=tg_argv[0];
  v_paused boolean;
begin
  select paused into v_paused
    from public.operational_controls
    where feature=v_feature
    for share;
  if not found then
    raise exception using
      errcode='P0001',
      message=format('Operational capability %s is unavailable',v_feature),
      detail=v_feature||'_UNAVAILABLE';
  end if;
  if v_paused then
    raise exception using
      errcode='P0001',
      message=format('Operational capability %s is paused',v_feature),
      detail=v_feature||'_PAUSED';
  end if;
  return new;
end;
$$;

drop trigger if exists verification_jobs_operational_guard on public.verification_jobs_v2;
create trigger verification_jobs_operational_guard
before insert on public.verification_jobs_v2
for each row execute function public.enforce_database_operational_control('RUNS');

drop trigger if exists verification_job_starts_operational_guard on public.verification_jobs_v2;
create trigger verification_job_starts_operational_guard
before update of status on public.verification_jobs_v2
for each row
when (old.status='QUEUED' and new.status in ('LEASED','RUNNING'))
execute function public.enforce_database_operational_control('RUNS');

drop trigger if exists review_packets_operational_guard on public.review_packets_v2;
create trigger review_packets_operational_guard
before insert on public.review_packets_v2
for each row execute function public.enforce_database_operational_control('REVIEWS');

drop trigger if exists review_decisions_operational_guard on public.review_packets_v2;
create trigger review_decisions_operational_guard
before update of decision on public.review_packets_v2
for each row
when (old.decision is null and new.decision is not null)
execute function public.enforce_database_operational_control('REVIEWS');

drop trigger if exists invoice_jobs_insert_operational_guard on public.invoice_jobs;
create trigger invoice_jobs_insert_operational_guard
before insert on public.invoice_jobs
for each row execute function public.enforce_database_operational_control('INVOICES');

drop trigger if exists invoice_jobs_processing_operational_guard on public.invoice_jobs;
create trigger invoice_jobs_processing_operational_guard
before update of status on public.invoice_jobs
for each row
when (old.status is distinct from 'PROCESSING' and new.status='PROCESSING')
execute function public.enforce_database_operational_control('INVOICES');

revoke all on function public.enforce_database_operational_control()
  from public,anon,authenticated;

insert into public.app_schema_versions(version,description)
values('202607260004','Transaction-level guards for paused runs, reviews, decisions, and invoices')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
