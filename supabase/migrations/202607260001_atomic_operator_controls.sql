-- Make emergency workflow-control changes and their operator audit record one
-- database transaction. The application still applies environment overrides
-- before this database state.

create or replace function public.set_operational_control_atomic(
  p_feature text,
  p_paused boolean,
  p_reason text,
  p_operator_email text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_control public.operational_controls;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if p_feature not in ('RUNS', 'REVIEWS', 'INVOICES') then
    raise exception 'Unknown operational capability';
  end if;
  if p_paused and char_length(v_reason) < 10 then
    raise exception 'A clear pause reason is required';
  end if;

  select * into v_control
  from public.operational_controls
  where feature = p_feature
  for update;
  if v_control.feature is null then
    raise exception 'Operational capability is unavailable';
  end if;

  update public.operational_controls
  set paused = p_paused,
      reason = case when p_paused then v_reason else '' end,
      updated_by = lower(trim(p_operator_email)),
      updated_at = p_now
  where feature = p_feature
  returning * into v_control;

  insert into public.operator_action_events(
    operator_email,
    action_type,
    target_type,
    target_id,
    details
  ) values (
    lower(trim(p_operator_email)),
    p_feature || case when p_paused then '_PAUSED' else '_RESUMED' end,
    'operational_control',
    p_feature,
    jsonb_build_object(
      'paused', p_paused,
      'reason', case when p_paused then v_reason else '' end,
      'changedAt', p_now
    )
  );

  return jsonb_build_object(
    'feature', v_control.feature,
    'paused', v_control.paused,
    'reason', v_control.reason,
    'updated_by', v_control.updated_by,
    'updated_at', v_control.updated_at
  );
end;
$$;

revoke all on function public.set_operational_control_atomic(text,boolean,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_operational_control_atomic(text,boolean,text,text,timestamptz)
  to service_role;

insert into public.app_schema_versions(version, description)
values (
  '202607260001',
  'Atomic emergency workflow controls with durable operator audit'
)
on conflict(version) do update
set description = excluded.description,
    applied_at = clock_timestamp();
