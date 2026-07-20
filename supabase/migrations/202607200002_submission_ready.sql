-- Durable, service-owned records for the public hackathon workflow.
-- These tables are intentionally unavailable to anon/authenticated clients;
-- all access goes through validated server routes using the service role.

create table public.transaction_records (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  owner_token_hash text not null unique,
  mode text not null check (mode in ('GUIDED_DEMO','IMPORTED_FIXTURE')),
  agency_name text not null,
  client_name text not null,
  project_name text not null,
  milestone_title text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source_name text not null,
  source_sha256 text not null,
  confirmed_criteria jsonb not null,
  target_origin text not null,
  revision integer not null default 1 check (revision > 0),
  status text not null check (status in ('READY','VERIFYING','NEEDS_WORK','READY_FOR_REVIEW','IN_REVIEW','CHANGES_REQUESTED','APPROVED')),
  retention_until timestamptz not null default (now() + interval '4 years'),
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.verification_jobs_v2 (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.transaction_records(id) on delete restrict,
  status text not null check (status in ('QUEUED','LEASED','RUNNING','COMPLETED','FAILED','EXPIRED')),
  attempt integer not null default 0,
  target_origin text not null,
  build_url text not null,
  build_label text not null,
  checks jsonb not null,
  results jsonb,
  artifacts jsonb not null default '[]',
  browser_version text,
  runner_version text,
  manifest_sha256 text,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.review_packets_v2 (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.transaction_records(id) on delete restrict,
  run_id uuid not null references public.verification_jobs_v2(id) on delete restrict,
  public_id text not null unique,
  snapshot jsonb not null,
  snapshot_sha256 text not null,
  bearer_token_hash text not null unique,
  session_hash text,
  expires_at timestamptz not null,
  decision text check (decision in ('APPROVED','CHANGES_REQUESTED')),
  reviewer_name text,
  reviewer_email text,
  reviewer_note text,
  intent_confirmed boolean,
  electronic_records_consent boolean,
  notice_version text,
  actor_hash text,
  country_code text,
  decided_at timestamptz,
  receipt_sha256 text,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '72 hours')
);

create table public.evidence_artifacts_v2 (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.transaction_records(id) on delete restrict,
  run_id uuid not null references public.verification_jobs_v2(id) on delete restrict,
  criterion_id text not null,
  kind text not null check (kind in ('SCREENSHOT','NETWORK','AXE','MANIFEST')),
  storage_path text,
  mime_type text not null,
  byte_size integer not null check (byte_size >= 0),
  sha256 text not null,
  expires_at timestamptz not null default (now() + interval '90 days'),
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  unique (run_id, criterion_id, kind)
);

create table public.transaction_audit_events (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.transaction_records(id) on delete restrict,
  sequence integer not null,
  event_type text not null,
  actor_type text not null check (actor_type in ('OWNER','REVIEWER','SYSTEM','RUNNER')),
  actor_hash text,
  payload jsonb not null default '{}',
  previous_hash text not null,
  event_hash text not null unique,
  occurred_at timestamptz not null,
  retention_until timestamptz not null,
  unique (record_id, sequence)
);

create table public.privacy_requests_v2 (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  request_type text not null check (request_type in ('ACCESS','CORRECTION','DELETION','EXPORT','OTHER')),
  email text not null,
  details text,
  actor_hash text,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','VERIFYING','PROCESSING','COMPLETED','DENIED')),
  retention_until timestamptz not null default (now() + interval '24 months'),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index transaction_records_retention_idx on public.transaction_records(retention_until);
create index verification_jobs_v2_record_idx on public.verification_jobs_v2(record_id, created_at desc);
create index review_packets_v2_token_idx on public.review_packets_v2(bearer_token_hash);
create index evidence_artifacts_v2_expiry_idx on public.evidence_artifacts_v2(expires_at);
create index transaction_audit_events_record_idx on public.transaction_audit_events(record_id, sequence);
create index privacy_requests_v2_status_idx on public.privacy_requests_v2(status, created_at);

alter table public.transaction_records enable row level security;
alter table public.verification_jobs_v2 enable row level security;
alter table public.review_packets_v2 enable row level security;
alter table public.evidence_artifacts_v2 enable row level security;
alter table public.transaction_audit_events enable row level security;
alter table public.privacy_requests_v2 enable row level security;

create trigger transaction_records_touch_updated_at
before update on public.transaction_records
for each row execute function public.touch_updated_at();

create or replace function public.append_transaction_event(
  p_record_id uuid,
  p_event_type text,
  p_actor_type text,
  p_actor_hash text,
  p_payload jsonb
) returns public.transaction_audit_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text := repeat('0', 64);
  v_sequence integer := 1;
  v_occurred_at timestamptz := clock_timestamp();
  v_retention_until timestamptz;
  v_hash text;
  v_event public.transaction_audit_events;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_record_id::text, 0));

  select event_hash, sequence + 1
    into v_previous, v_sequence
    from public.transaction_audit_events
   where record_id = p_record_id
   order by sequence desc
   limit 1;

  v_previous := coalesce(v_previous, repeat('0', 64));
  v_sequence := coalesce(v_sequence, 1);

  select retention_until into v_retention_until
    from public.transaction_records
   where id = p_record_id;

  if v_retention_until is null then
    raise exception 'Unknown transaction record';
  end if;

  v_hash := encode(digest(
    v_previous || '|' || p_record_id::text || '|' || v_sequence::text || '|' ||
    p_event_type || '|' || p_actor_type || '|' || coalesce(p_actor_hash, '') || '|' ||
    p_payload::text || '|' || to_char(v_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'sha256'
  ), 'hex');

  insert into public.transaction_audit_events (
    record_id, sequence, event_type, actor_type, actor_hash, payload,
    previous_hash, event_hash, occurred_at, retention_until
  ) values (
    p_record_id, v_sequence, p_event_type, p_actor_type, p_actor_hash,
    coalesce(p_payload, '{}'::jsonb), v_previous, v_hash, v_occurred_at,
    v_retention_until
  ) returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.append_transaction_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_transaction_event(uuid, text, text, text, jsonb) to service_role;

create or replace function public.prevent_transaction_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('milestoneproof.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Transaction audit events are append-only';
end;
$$;

create trigger transaction_audit_events_immutable
before update or delete on public.transaction_audit_events
for each row execute function public.prevent_transaction_event_mutation();

create or replace function public.purge_expired_transaction_record(p_record_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.transaction_records;
begin
  select * into v_record from public.transaction_records where id = p_record_id for update;
  if v_record.id is null or v_record.legal_hold or v_record.retention_until > now() then
    return false;
  end if;

  perform set_config('milestoneproof.retention_purge', 'on', true);
  delete from public.review_packets_v2 where record_id = p_record_id;
  delete from public.evidence_artifacts_v2 where record_id = p_record_id;
  delete from public.verification_jobs_v2 where record_id = p_record_id;
  delete from public.transaction_audit_events where record_id = p_record_id;
  delete from public.transaction_records where id = p_record_id;
  return true;
end;
$$;

revoke all on function public.purge_expired_transaction_record(uuid) from public, anon, authenticated;
grant execute on function public.purge_expired_transaction_record(uuid) to service_role;
