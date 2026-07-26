-- Freeze evidence metadata under the same verification-job row lock used by
-- completion. Object bytes are written to immutable, content-addressed paths
-- before this function is called; a completion race therefore either sees the
-- committed metadata or causes this function to reject the late upload.

create unique index if not exists one_evidence_artifact_per_run_criterion
  on public.evidence_artifacts_v2(run_id,criterion_id);

create or replace function public.record_evidence_artifact_atomic(
  p_job_id uuid,
  p_lease_id uuid,
  p_criterion_id text,
  p_kind text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size integer,
  p_sha256 text,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.verification_jobs_v2;
  v_existing public.evidence_artifacts_v2;
begin
  select * into v_job
    from public.verification_jobs_v2
    where id=p_job_id
    for update;

  if v_job.id is null then
    raise exception using
      errcode='P0001',
      message='Verification job not found',
      detail='EVIDENCE_JOB_NOT_FOUND';
  end if;
  if v_job.status<>'RUNNING' or v_job.lease_id is distinct from p_lease_id then
    raise exception using
      errcode='P0001',
      message='Evidence belongs to an inactive or stale verification lease',
      detail='STALE_EVIDENCE_LEASE';
  end if;
  if not exists(
    select 1
    from jsonb_array_elements(coalesce(v_job.checks,'[]'::jsonb)) item
    where item->>'criterionId'=p_criterion_id
  ) then
    raise exception using
      errcode='P0001',
      message='Evidence criterion is not in the frozen check manifest',
      detail='EVIDENCE_CRITERION_MISMATCH';
  end if;
  if p_kind not in ('SCREENSHOT','NETWORK','AXE','MANIFEST')
     or p_mime_type not in ('image/jpeg','image/png','application/json')
     or p_byte_size<=0
     or p_sha256 !~ '^[a-f0-9]{64}$'
     or p_storage_path is null
     or length(p_storage_path)>500
     or position(p_sha256 in p_storage_path)=0
     or p_storage_path not like
       v_job.record_id::text||'/'||p_job_id::text||'/%' then
    raise exception using
      errcode='P0001',
      message='Evidence metadata is invalid',
      detail='EVIDENCE_METADATA_INVALID';
  end if;

  select * into v_existing
    from public.evidence_artifacts_v2
    where run_id=p_job_id
      and criterion_id=p_criterion_id
    order by created_at,id
    limit 1
    for update;

  if v_existing.id is not null then
    if v_existing.record_id=v_job.record_id
       and v_existing.kind=p_kind
       and v_existing.storage_path=p_storage_path
       and v_existing.mime_type=p_mime_type
       and v_existing.byte_size=p_byte_size
       and v_existing.sha256=p_sha256 then
      return 'DUPLICATE';
    end if;
    raise exception using
      errcode='P0001',
      message='Evidence slot is already frozen with different content',
      detail='EVIDENCE_SLOT_CONFLICT';
  end if;

  insert into public.evidence_artifacts_v2(
    record_id,
    run_id,
    criterion_id,
    kind,
    storage_path,
    mime_type,
    byte_size,
    sha256,
    expires_at
  ) values(
    v_job.record_id,
    p_job_id,
    p_criterion_id,
    p_kind,
    p_storage_path,
    p_mime_type,
    p_byte_size,
    p_sha256,
    p_expires_at
  );

  return 'RECORDED';
end;
$$;

revoke all on function public.record_evidence_artifact_atomic(
  uuid,uuid,text,text,text,text,integer,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.record_evidence_artifact_atomic(
  uuid,uuid,text,text,text,text,integer,text,timestamptz
) to service_role;

insert into public.app_schema_versions(version,description)
values('202607260006','Atomic immutable evidence-artifact recording under the completion job lock')
on conflict(version) do update
set description=excluded.description,applied_at=clock_timestamp();
