-- Closed agency beta: durable owner accounts, operational controls, and feedback.

alter table public.transaction_records
  add column if not exists owner_user_id uuid references auth.users(id) on delete restrict;

alter table public.transaction_records drop constraint if exists transaction_records_mode_check;
alter table public.transaction_records
  add constraint transaction_records_mode_check
  check (mode in ('GUIDED_DEMO','IMPORTED_FIXTURE','CUSTOM_TARGET'));

create index if not exists transaction_records_owner_user_idx
  on public.transaction_records(owner_user_id, updated_at desc);

alter table public.review_packets_v2
  add column if not exists revoked_at timestamptz;

alter table public.review_packets_v2 drop constraint if exists review_packets_v2_check;
alter table public.review_packets_v2
  add constraint review_packets_v2_expiry_limit
  check (expires_at <= created_at + interval '14 days');

create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  owner_user_id uuid references auth.users(id) on delete set null,
  record_id uuid references public.transaction_records(id) on delete set null,
  email text,
  category text not null check (category in ('BUG','CONFUSING','IDEA','OTHER')),
  message text not null,
  page_path text not null,
  actor_hash text,
  status text not null default 'NEW' check (status in ('NEW','REVIEWING','RESOLVED','CLOSED')),
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '24 months')
);

create index if not exists beta_feedback_status_idx
  on public.beta_feedback(status, created_at desc);

create table if not exists public.operator_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  record_id uuid references public.transaction_records(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  delivery_status text not null default 'IN_APP' check (delivery_status in ('IN_APP','PENDING_EMAIL','SENT','FAILED')),
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '180 days')
);

create index if not exists operator_notifications_owner_idx
  on public.operator_notifications(owner_user_id, read_at, created_at desc);

create table if not exists public.operational_events (
  id bigint generated always as identity primary key,
  severity text not null check (severity in ('INFO','WARN','ERROR')),
  service text not null,
  event_type text not null,
  record_id uuid references public.transaction_records(id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '90 days')
);

create index if not exists operational_events_recent_idx
  on public.operational_events(severity, created_at desc);

create table if not exists public.api_rate_windows (
  rate_key text not null,
  scope text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (rate_key, scope, window_started_at)
);

create index if not exists api_rate_windows_expiry_idx
  on public.api_rate_windows(expires_at);

alter table public.beta_feedback enable row level security;
alter table public.operator_notifications enable row level security;
alter table public.operational_events enable row level security;
alter table public.api_rate_windows enable row level security;

create or replace function public.consume_api_quota(
  p_rate_key text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid quota configuration';
  end if;

  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.api_rate_windows(rate_key, scope, window_started_at, request_count, expires_at)
  values (p_rate_key, p_scope, v_window, 1, v_window + make_interval(secs => p_window_seconds * 2))
  on conflict (rate_key, scope, window_started_at)
  do update set request_count = public.api_rate_windows.request_count + 1
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_api_quota(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_quota(text, text, integer, integer) to service_role;
