-- Minimal stand-ins for the Supabase-managed schemas the app migrations
-- assume exist (auth.*, storage.*, extensions.*). Good enough to validate
-- that our SQL is syntactically/semantically correct and its functions
-- behave as intended; it is not a full Supabase emulation (no real RLS
-- policy enforcement identity, no real Storage API).
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- pgcrypto's digest() lands in public in this stub; alias it into extensions
-- to match how the migrations reference extensions.digest(...).
create or replace function extensions.digest(data bytea, type text) returns bytea
language sql immutable as $$ select public.digest(data, type) $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;
