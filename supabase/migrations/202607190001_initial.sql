create extension if not exists pgcrypto;

create type public.milestone_status as enum (
  'DRAFT','ANALYZING','NEEDS_CONFIRMATION','READY','VERIFYING','NEEDS_WORK',
  'READY_FOR_REVIEW','IN_REVIEW','CHANGES_REQUESTED','APPROVED','RECEIPT_READY'
);
create type public.result_status as enum ('PASS','FAIL','ERROR','SKIPPED');
create type public.job_status as enum ('QUEUED','LEASED','RUNNING','COMPLETED','FAILED','EXPIRED');

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agency_name text not null,
  client_name text not null,
  project_name text not null,
  title text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  target_origin text,
  origin_verified_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  status public.milestone_status not null default 'DRAFT',
  synthetic_data_attested boolean not null default false,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  storage_path text,
  file_name text,
  mime_type text,
  byte_size integer check (byte_size between 1 and 5242880),
  page_count integer check (page_count between 1 and 25),
  source_sha256 text not null,
  normalized_selected_text text not null,
  selected_pages integer[] not null default '{}',
  original_deleted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  revision integer not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('RUNNING','COMPLETED','FAILED')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  revision integer not null,
  display_id text not null,
  title text not null,
  source_quote text not null,
  source_start integer,
  source_end integer,
  supported boolean not null,
  check_spec jsonb,
  confirmed_by_human boolean not null default false,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (milestone_id, revision, display_id),
  check (not supported or check_spec is not null)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  revision integer not null,
  idempotency_key text not null,
  status public.job_status not null default 'QUEUED',
  attempt integer not null default 0,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (milestone_id, idempotency_key)
);

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  revision integer not null,
  target_origin text not null,
  build_url text not null,
  build_label text not null,
  browser_version text,
  runner_version text not null,
  is_stale boolean not null default false,
  started_at timestamptz not null,
  completed_at timestamptz,
  manifest_sha256 text,
  created_at timestamptz not null default now()
);

create table public.criterion_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.verification_runs(id) on delete cascade,
  criterion_id uuid not null references public.criteria(id) on delete restrict,
  status public.result_status not null,
  expected text not null,
  observed text not null,
  duration_ms integer not null check (duration_ms >= 0),
  viewport jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  unique (run_id, criterion_id)
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  run_id uuid references public.verification_runs(id) on delete cascade,
  result_id uuid references public.criterion_results(id) on delete cascade,
  kind text not null check (kind in ('SCREENSHOT','NETWORK','AXE','MANIFEST','RECEIPT_HTML','RECEIPT_PDF')),
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  sha256 text not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create table public.review_packets (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  run_id uuid not null references public.verification_runs(id) on delete restrict,
  revision integer not null,
  snapshot jsonb not null,
  snapshot_sha256 text not null,
  bearer_token_hash text not null unique,
  session_hash text,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  decision text check (decision in ('APPROVED','CHANGES_REQUESTED')),
  reviewer_name text,
  reviewer_note text,
  decided_at timestamptz,
  receipt_sha256 text,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '72 hours')
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  actor_type text not null check (actor_type in ('OWNER','REVIEWER','SYSTEM','RUNNER')),
  actor_hash text,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index criteria_milestone_revision_idx on public.criteria(milestone_id, revision);
create index jobs_status_created_idx on public.jobs(status, created_at);
create index runs_milestone_created_idx on public.verification_runs(milestone_id, created_at desc);
create index artifacts_expiry_idx on public.artifacts(expires_at);
create index reviews_token_idx on public.review_packets(bearer_token_hash);
create index audit_milestone_created_idx on public.audit_events(milestone_id, created_at desc);

alter table public.milestones enable row level security;
alter table public.source_documents enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.criteria enable row level security;
alter table public.jobs enable row level security;
alter table public.verification_runs enable row level security;
alter table public.criterion_results enable row level security;
alter table public.artifacts enable row level security;
alter table public.review_packets enable row level security;
alter table public.audit_events enable row level security;

create policy "owners manage milestones" on public.milestones for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners manage sources" on public.source_documents for all using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid())) with check (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners manage analyses" on public.analysis_runs for all using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid())) with check (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners manage criteria" on public.criteria for all using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid())) with check (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners read jobs" on public.jobs for select using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners read runs" on public.verification_runs for select using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners read results" on public.criterion_results for select using (exists(select 1 from public.verification_runs r join public.milestones m on m.id = r.milestone_id where r.id = run_id and m.owner_id = auth.uid()));
create policy "owners read artifacts" on public.artifacts for select using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners manage reviews" on public.review_packets for all using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid())) with check (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));
create policy "owners read audit" on public.audit_events for select using (exists(select 1 from public.milestones m where m.id = milestone_id and m.owner_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('source-documents', 'source-documents', false, 5242880, array['application/pdf']),
  ('evidence', 'evidence', false, 10485760, array['image/png','application/json','text/html','application/pdf'])
on conflict (id) do nothing;

create policy "owners upload source files" on storage.objects for insert to authenticated
with check (bucket_id = 'source-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners read source files" on storage.objects for select to authenticated
using (bucket_id = 'source-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners read evidence" on storage.objects for select to authenticated
using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger milestones_touch_updated_at before update on public.milestones for each row execute function public.touch_updated_at();

