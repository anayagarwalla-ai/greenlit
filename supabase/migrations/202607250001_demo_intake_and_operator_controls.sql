-- Add a privacy-minimized demo-request queue and operator-controlled pause
-- switches before the company-design-partner outreach phase.

create table if not exists public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (email = lower(email) and char_length(email) <= 320),
  agency_name text not null check (char_length(agency_name) between 2 and 160),
  role text not null check (char_length(role) between 2 and 120),
  agency_size text not null check (agency_size in ('1','2-10','11-25','26-50','51+')),
  location text not null check (char_length(location) between 2 and 120),
  monthly_milestone_volume text not null check (monthly_milestone_volume in ('1-2','3-5','6-10','11-25','26+')),
  approval_delay_days integer not null check (approval_delay_days between 0 and 365),
  staging_model text not null check (staging_model in ('public-https','password-protected','platform-protected','client-environment','other')),
  desired_next_step text not null check (desired_next_step in ('discovery-call','synthetic-demo','design-partner')),
  current_process text not null check (char_length(current_process) between 20 and 2000),
  source_path text not null default '/request-demo' check (source_path like '/%'),
  actor_hash text not null,
  status text not null default 'NEW' check (status in ('NEW','QUALIFYING','BOOKED','CLOSED','DECLINED')),
  assigned_to text,
  internal_notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists demo_requests_status_created_idx on public.demo_requests(status,created_at desc);
create index if not exists demo_requests_email_idx on public.demo_requests(email);
alter table public.demo_requests enable row level security;
revoke all on public.demo_requests from public,anon,authenticated;
grant select,insert,update on public.demo_requests to service_role;

create table if not exists public.operational_controls (
  feature text primary key check (feature in ('RUNS','REVIEWS','INVOICES')),
  paused boolean not null default false,
  reason text not null default '',
  updated_by text,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.operational_controls(feature) values ('RUNS'),('REVIEWS'),('INVOICES')
on conflict(feature) do nothing;
alter table public.operational_controls enable row level security;
revoke all on public.operational_controls from public,anon,authenticated;
grant select,update on public.operational_controls to service_role;

insert into public.app_schema_versions(version,description)
values('202607250001','Demo-request intake and operator-controlled workflow pause switches')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
