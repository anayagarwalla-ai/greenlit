-- Supabase installs pgcrypto in the extensions schema. Convert the canonical
-- audit string to UTF-8 bytes explicitly so digest resolves consistently.

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

  v_hash := encode(extensions.digest(convert_to(
    v_previous || '|' || p_record_id::text || '|' || v_sequence::text || '|' ||
    p_event_type || '|' || p_actor_type || '|' || coalesce(p_actor_hash, '') || '|' ||
    p_payload::text || '|' || to_char(v_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'UTF8'
  ), 'sha256'::text), 'hex');

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
