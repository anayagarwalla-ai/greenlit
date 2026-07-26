-- Queue temporary Auth accounts as soon as they are created, expire unclicked
-- verification accounts after the link window, and retain only a short,
-- minimized cleanup receipt after processing.

alter table public.privacy_verification_account_cleanups
  add column if not exists email_hash text,
  add column if not exists cleanup_after timestamptz;

alter table public.privacy_account_deletions
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists email_hash text;

alter table public.evidence_artifacts_v2
  add column if not exists deletion_attempts integer not null default 0,
  add column if not exists deletion_next_attempt_at timestamptz not null default now();

alter table public.transaction_records
  add column if not exists deletion_attempts integer not null default 0,
  add column if not exists deletion_next_attempt_at timestamptz not null default now();

update public.privacy_verification_account_cleanups
set email_hash=encode(
      extensions.digest(convert_to(lower(trim(email)),'UTF8'),'sha256'::text),
      'hex'
    ),
    cleanup_after=coalesce(completed_at,requested_at),
    retention_until=coalesce(completed_at,requested_at)+interval '7 days'
where email_hash is null or cleanup_after is null;

update public.privacy_account_deletions
set email_hash=encode(
      extensions.digest(convert_to(lower(trim(email)),'UTF8'),'sha256'::text),
      'hex'
    ),
    email=case when status='COMPLETED' then null else lower(trim(email)) end,
    completed_at=case
      when status='COMPLETED' then coalesce(completed_at,requested_at)
      else null
    end,
    retention_until=case
      when status='COMPLETED' then
        least(retention_until,coalesce(completed_at,requested_at)+interval '30 days')
      else retention_until
    end
where email_hash is null or email<>lower(trim(email)) or status='COMPLETED';

alter table public.privacy_account_deletions
  alter column email drop not null,
  alter column email_hash set not null,
  drop constraint if exists privacy_account_deletion_email_hash_check,
  drop constraint if exists privacy_account_deletion_completion_check,
  add constraint privacy_account_deletion_email_hash_check
    check(email_hash ~ '^[0-9a-f]{64}$'),
  add constraint privacy_account_deletion_completion_check
    check(
      (
        status='COMPLETED'
        and email is null
        and completed_at is not null
        and last_error is null
        and retention_until<=completed_at+interval '30 days'
      )
      or (
        status in ('PENDING','FAILED')
        and email is not null
        and completed_at is null
      )
    );

create or replace function public.enforce_privacy_account_deletion_lifecycle()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.email is not null then
    new.email:=lower(trim(new.email));
    new.email_hash:=encode(
      extensions.digest(convert_to(new.email,'UTF8'),'sha256'::text),
      'hex'
    );
  end if;
  if new.status='COMPLETED' then
    new.completed_at:=coalesce(new.completed_at,clock_timestamp());
    new.email:=null;
    new.last_error:=null;
    new.retention_until:=least(
      new.retention_until,
      new.completed_at+interval '30 days'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists privacy_account_deletion_lifecycle
  on public.privacy_account_deletions;
create trigger privacy_account_deletion_lifecycle
before insert or update of email,status,completed_at
on public.privacy_account_deletions
for each row
execute function public.enforce_privacy_account_deletion_lifecycle();

alter table public.privacy_verification_account_cleanups
  alter column email_hash set not null,
  alter column cleanup_after set not null,
  alter column retention_until set default (now()+interval '7 days'),
  drop column email;

alter table public.privacy_verification_account_cleanups
  drop constraint if exists privacy_verification_cleanup_email_hash_check,
  drop constraint if exists privacy_verification_cleanup_timing_check,
  drop constraint if exists privacy_verification_cleanup_completion_check,
  add constraint privacy_verification_cleanup_email_hash_check
    check(email_hash ~ '^[0-9a-f]{64}$'),
  add constraint privacy_verification_cleanup_timing_check
    check(cleanup_after>=requested_at and retention_until>requested_at),
  add constraint privacy_verification_cleanup_completion_check
    check(
      (
        status='COMPLETED'
        and disposition is not null
        and completed_at is not null
        and last_error is null
        and retention_until<=completed_at+interval '7 days'
      )
      or (
        status in ('PENDING','FAILED')
        and disposition is null
        and completed_at is null
      )
    );

drop index if exists public.privacy_verification_account_cleanup_status_idx;
create index privacy_verification_account_cleanup_status_idx
  on public.privacy_verification_account_cleanups(status,cleanup_after,requested_at);
create index if not exists privacy_account_deletion_retry_idx
  on public.privacy_account_deletions(status,next_attempt_at,requested_at);
create index if not exists evidence_artifact_deletion_retry_idx
  on public.evidence_artifacts_v2(
    deletion_status,
    deletion_next_attempt_at,
    expires_at
  );
create index if not exists transaction_record_deletion_retry_idx
  on public.transaction_records(
    deletion_status,
    deletion_next_attempt_at,
    retention_until
  );
create index if not exists beta_invite_removal_retention_idx
  on public.beta_invites(status,retention_until)
  where status='REMOVED';

update public.beta_invites
set retention_until=coalesce(removed_at,invited_at)+interval '4 years'
where status='REMOVED';

create or replace function public.enforce_beta_invite_removal_retention()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status='REMOVED' then
    new.removed_at:=coalesce(new.removed_at,clock_timestamp());
    new.retention_until:=new.removed_at+interval '4 years';
  elsif tg_op='UPDATE' and old.status='REMOVED' then
    new.removed_at:=null;
    new.retention_until:=clock_timestamp()+interval '4 years';
  end if;
  return new;
end;
$$;

drop trigger if exists beta_invite_removal_retention
  on public.beta_invites;
create trigger beta_invite_removal_retention
before insert or update of status,removed_at
on public.beta_invites
for each row
execute function public.enforce_beta_invite_removal_retention();

create or replace function public.queue_privacy_verification_account_cleanup_atomic(
  p_request_id uuid,
  p_auth_user_id uuid,
  p_email text,
  p_cleanup_after timestamptz,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request_email text;
  v_normalized_email text:=lower(trim(p_email));
  v_cleanup_after timestamptz;
  v_cleanup_id uuid;
begin
  if p_auth_user_id is null or v_normalized_email='' or p_cleanup_after is null or p_now is null then
    raise exception 'Privacy verification cleanup input is incomplete';
  end if;

  if p_request_id is not null then
    select email into v_request_email
      from public.privacy_requests_v2
      where id=p_request_id;
    if not found or lower(trim(v_request_email)) is distinct from v_normalized_email then
      raise exception 'Privacy verification cleanup request does not match';
    end if;
  end if;

  v_cleanup_after:=greatest(p_cleanup_after,p_now);
  insert into public.privacy_verification_account_cleanups(
    request_id,
    auth_user_id,
    email_hash,
    status,
    requested_at,
    cleanup_after,
    retention_until
  ) values(
    p_request_id,
    p_auth_user_id,
    encode(
      extensions.digest(convert_to(v_normalized_email,'UTF8'),'sha256'::text),
      'hex'
    ),
    'PENDING',
    p_now,
    v_cleanup_after,
    v_cleanup_after+interval '7 days'
  )
  on conflict(auth_user_id) where status in ('PENDING','FAILED')
  do update set
    request_id=coalesce(excluded.request_id,privacy_verification_account_cleanups.request_id),
    email_hash=excluded.email_hash,
    status='PENDING',
    disposition=null,
    last_error=null,
    cleanup_after=least(
      excluded.cleanup_after,
      privacy_verification_account_cleanups.cleanup_after
    ),
    completed_at=null,
    retention_until=least(
      excluded.cleanup_after,
      privacy_verification_account_cleanups.cleanup_after
    )+interval '7 days'
  returning id into v_cleanup_id;

  return jsonb_build_object('cleanupId',v_cleanup_id);
end;
$$;

create or replace function public.complete_privacy_email_verification_atomic(
  p_public_id text,
  p_verification_token_hash text,
  p_email text,
  p_auth_user_id uuid,
  p_verified_at timestamptz,
  p_cleanup_verification_account boolean
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.privacy_requests_v2;
  v_cleanup jsonb;
begin
  select * into v_request
    from public.privacy_requests_v2
    where public_id=p_public_id
    for update;
  if v_request.id is null or v_request.identity_verified_at is not null then
    raise exception 'Privacy request unavailable';
  end if;
  if lower(v_request.email) is distinct from lower(trim(p_email))
     or v_request.verification_token_hash is distinct from p_verification_token_hash
     or v_request.verification_expires_at<=p_verified_at then
    raise exception 'Privacy verification is invalid or expired';
  end if;

  update public.privacy_requests_v2
    set identity_verified_at=p_verified_at,
      verification_method='SUPABASE_EMAIL_OTP',
      verified_auth_user_id=p_auth_user_id,
      verification_token_hash=null,
      verification_expires_at=null,
      status=case when status='RECEIVED' then 'VERIFYING' else status end,
      updated_at=p_verified_at
    where id=v_request.id;

  if p_cleanup_verification_account then
    v_cleanup:=public.queue_privacy_verification_account_cleanup_atomic(
      v_request.id,
      p_auth_user_id,
      p_email,
      p_verified_at,
      p_verified_at
    );
  end if;

  return jsonb_build_object(
    'requestId',
    v_request.id,
    'cleanupId',
    v_cleanup->>'cleanupId'
  );
end;
$$;

-- Retryable retention work is eligible only after its bounded exponential
-- backoff. Ordering by the next eligible time prevents a repeatedly failing
-- old row from monopolizing every bounded maintenance batch.
create or replace function public.stage_expired_evidence_deletion(
  p_limit integer,
  p_now timestamptz
) returns table(id uuid,record_id uuid,storage_path text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_candidate record;
  v_record public.transaction_records;
  v_evidence public.evidence_artifacts_v2;
  v_count integer:=0;
begin
  for v_candidate in
    select e.id,e.record_id
    from public.evidence_artifacts_v2 e
    join public.transaction_records r on r.id=e.record_id
    where e.expires_at<=p_now
      and not e.legal_hold
      and not r.legal_hold
      and (
        e.deletion_status='ACTIVE'
        or (
          e.deletion_status='FAILED'
          and e.deletion_next_attempt_at<=p_now
        )
        or (
          e.deletion_status='PENDING'
          and coalesce(e.deletion_requested_at,'-infinity'::timestamptz)
            <=p_now-interval '15 minutes'
        )
      )
      and r.deletion_status='ACTIVE'
    order by
      case
        when e.deletion_status='FAILED' then e.deletion_next_attempt_at
        when e.deletion_status='PENDING' then e.deletion_requested_at
        else e.expires_at
      end,
      e.id
    limit greatest(1,least(coalesce(p_limit,50),500))
  loop
    v_record:=null;
    v_evidence:=null;
    select * into v_record
      from public.transaction_records r
      where r.id=v_candidate.record_id
      for update skip locked;
    if v_record.id is null
       or v_record.legal_hold
       or v_record.deletion_status<>'ACTIVE' then
      continue;
    end if;
    select * into v_evidence
      from public.evidence_artifacts_v2 e
      where e.id=v_candidate.id
      for update skip locked;
    if v_evidence.id is null
       or v_evidence.record_id<>v_record.id
       or v_evidence.legal_hold
       or v_evidence.expires_at>p_now
       or (
         v_evidence.deletion_status='FAILED'
         and v_evidence.deletion_next_attempt_at>p_now
       )
       or (
         v_evidence.deletion_status='PENDING'
         and coalesce(
           v_evidence.deletion_requested_at,
           '-infinity'::timestamptz
         )>p_now-interval '15 minutes'
       )
       or v_evidence.deletion_status not in ('ACTIVE','FAILED','PENDING') then
      continue;
    end if;
    update public.evidence_artifacts_v2 e
      set deletion_status='PENDING',
        deletion_requested_at=p_now,
        deletion_error=null,
        deletion_attempts=deletion_attempts+1
      where e.id=v_evidence.id;
    perform public.append_transaction_event(
      v_record.id,
      'EVIDENCE_DELETION_STAGED',
      'SYSTEM',
      null,
      jsonb_build_object(
        'artifactId',v_evidence.id,
        'attempt',v_evidence.deletion_attempts+1,
        'processedAt',p_now
      )
    );
    id:=v_evidence.id;
    record_id:=v_record.id;
    storage_path:=v_evidence.storage_path;
    return next;
    v_count:=v_count+1;
    if v_count>=greatest(1,least(coalesce(p_limit,50),500)) then
      exit;
    end if;
  end loop;
end;
$$;

create or replace function public.fail_evidence_deletion_atomic(
  p_ids uuid[],
  p_record_id uuid,
  p_error text,
  p_processed_at timestamptz
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer;
  v_next_attempt_at timestamptz;
begin
  select p_processed_at+make_interval(
    mins=>least(
      1440,
      5*power(
        2,
        least(greatest(max(deletion_attempts)-1,0),16)
      )::integer
    )
  )
  into v_next_attempt_at
  from public.evidence_artifacts_v2
  where id=any(p_ids)
    and record_id=p_record_id
    and deletion_status='PENDING';

  update public.evidence_artifacts_v2
    set deletion_status='FAILED',
      deletion_error=left(p_error,500),
      deletion_next_attempt_at=coalesce(
        v_next_attempt_at,
        p_processed_at+interval '5 minutes'
      )
    where id=any(p_ids)
      and record_id=p_record_id
      and deletion_status='PENDING';
  get diagnostics v_count=row_count;
  if v_count>0 then
    perform public.append_transaction_event(
      p_record_id,
      'EVIDENCE_DELETION_FAILED',
      'SYSTEM',
      null,
      jsonb_build_object(
        'artifactCount',v_count,
        'error',left(p_error,500),
        'nextAttemptAt',v_next_attempt_at,
        'processedAt',p_processed_at
      )
    );
  end if;
  return v_count;
end;
$$;

create or replace function public.stage_expired_record_deletion(
  p_limit integer,
  p_now timestamptz
) returns table(id uuid)
language sql
security definer
set search_path=public
as $$
  with candidates as (
    select r.id
    from public.transaction_records r
    where r.retention_until<=p_now
      and not r.legal_hold
      and r.active_job_id is null
      and (
        r.deletion_status='ACTIVE'
        or (
          r.deletion_status='FAILED'
          and r.deletion_next_attempt_at<=p_now
        )
        or (
          r.deletion_status='PENDING'
          and coalesce(r.deletion_requested_at,'-infinity'::timestamptz)
            <=p_now-interval '15 minutes'
        )
      )
      and not exists(
        select 1
        from public.evidence_artifacts_v2 e
        where e.record_id=r.id and e.legal_hold
      )
      and not exists(
        select 1
        from public.verification_jobs_v2 job
        where job.record_id=r.id
          and job.status in ('QUEUED','LEASED','RUNNING')
      )
    order by
      case
        when r.deletion_status='FAILED' then r.deletion_next_attempt_at
        when r.deletion_status='PENDING' then r.deletion_requested_at
        else r.retention_until
      end,
      r.id
    limit greatest(1,least(coalesce(p_limit,10),50))
    for update of r skip locked
  ),
  updated as (
    update public.transaction_records r
      set deletion_status='PENDING',
        deletion_requested_at=p_now,
        deletion_error=null,
        deletion_attempts=deletion_attempts+1
      where r.id in(select candidates.id from candidates)
      returning r.id
  )
  select updated.id from updated;
$$;

create or replace function public.fail_record_deletion_atomic(
  p_record_id uuid,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_attempts integer;
  v_next_attempt_at timestamptz;
begin
  select deletion_attempts into v_attempts
    from public.transaction_records
    where id=p_record_id and deletion_status='PENDING'
    for update;
  if not found then
    return false;
  end if;
  v_next_attempt_at:=clock_timestamp()+make_interval(
    mins=>least(
      1440,
      5*power(2,least(greatest(v_attempts-1,0),16))::integer
    )
  );
  update public.transaction_records
    set deletion_status='FAILED',
      deletion_error=left(p_error,1000),
      deletion_next_attempt_at=v_next_attempt_at
    where id=p_record_id;
  insert into public.operational_events(
    severity,service,event_type,record_id,details
  ) values(
    'ERROR',
    'retention',
    'RECORD_DELETION_FAILED',
    p_record_id,
    jsonb_build_object(
      'error',left(p_error,1000),
      'attempt',v_attempts,
      'nextAttemptAt',v_next_attempt_at
    )
  );
  return true;
end;
$$;

create or replace function public.retry_record_deletion_atomic(
  p_record_id uuid,
  p_operator_email text,
  p_now timestamptz
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.transaction_records
    set deletion_status='FAILED',
      deletion_error=null,
      deletion_next_attempt_at=p_now
    where id=p_record_id
      and deletion_status='FAILED'
      and privacy_deletion_requested_at is not null;
  if not found then
    return false;
  end if;
  perform public.record_operator_action(
    p_operator_email,
    'RETRY_RECORD_DELETION',
    'transaction_record',
    p_record_id::text,
    jsonb_build_object('queuedAt',p_now)
  );
  insert into public.operational_events(
    severity,service,event_type,record_id,details
  ) values(
    'INFO',
    'retention',
    'RECORD_DELETION_REQUEUED',
    p_record_id,
    jsonb_build_object('operator',p_operator_email,'queuedAt',p_now)
  );
  return true;
end;
$$;

create or replace function public.finalize_expired_record_deletion(
  p_record_id uuid
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_record public.transaction_records;
begin
  select * into v_record
    from public.transaction_records
    where id=p_record_id
    for update;
  if v_record.id is null
     or v_record.deletion_status<>'PENDING'
     or v_record.legal_hold
     or v_record.retention_until>now() then
    return false;
  end if;
  if exists(
    select 1
    from public.legal_holds_v2
    where record_id=p_record_id and active
  ) or exists(
    select 1
    from public.evidence_artifacts_v2
    where record_id=p_record_id and legal_hold
  ) then
    return false;
  end if;

  insert into public.operational_events(
    severity,service,event_type,record_id,details
  ) values(
    'INFO',
    'retention',
    'TRANSACTION_RECORD_PURGED',
    null,
    jsonb_build_object(
      'recordId',p_record_id,
      'processedAt',clock_timestamp()
    )
  );
  perform set_config('greenlit.retention_purge','on',true);
  delete from public.review_sessions_v2
    where packet_id in(
      select id from public.review_packets_v2 where record_id=p_record_id
    );
  delete from public.review_packets_v2 where record_id=p_record_id;
  delete from public.privacy_record_amendments where record_id=p_record_id;
  -- Released holds no longer protect the record and must not leave a
  -- restrictive child row that prevents the atomic purge. Active holds were
  -- checked above and remain a hard block.
  delete from public.legal_holds_v2
    where record_id=p_record_id and not active;
  delete from public.evidence_artifacts_v2 where record_id=p_record_id;
  delete from public.verification_jobs_v2 where record_id=p_record_id;
  delete from public.transaction_audit_events where record_id=p_record_id;
  delete from public.transaction_records where id=p_record_id;
  return true;
end;
$$;

create or replace function public.purge_expired_privacy_requests_atomic(
  p_now timestamptz,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.privacy_requests_v2;
  v_deleted integer:=0;
  v_overdue_nonterminal integer:=0;
begin
  for v_request in
    select request.*
    from public.privacy_requests_v2 request
    where request.retention_until<=p_now
      and not exists(
        select 1
        from public.legal_holds_v2 hold
        where hold.privacy_request_id=request.id and hold.active
      )
    order by request.retention_until,request.id
    for update skip locked
    limit least(greatest(coalesce(p_limit,500),1),1000)
  loop
    if v_request.status not in ('COMPLETED','DENIED') then
      v_overdue_nonterminal:=v_overdue_nonterminal+1;
      insert into public.operational_events(
        severity,service,event_type,details
      ) values(
        'WARN',
        'privacy',
        'OVERDUE_PRIVACY_REQUEST_RETENTION_PURGED',
        jsonb_build_object(
          'requestId',v_request.public_id,
          'previousStatus',v_request.status,
          'retentionUntil',v_request.retention_until,
          'purgedAt',p_now
        )
      );
    end if;
    delete from public.privacy_requests_v2 where id=v_request.id;
    v_deleted:=v_deleted+1;
  end loop;
  return jsonb_build_object(
    'deletedCount',v_deleted,
    'overdueNonterminalCount',v_overdue_nonterminal
  );
end;
$$;

create or replace function public.purge_completed_privacy_verification_cleanups_atomic(
  p_now timestamptz,
  p_limit integer
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_deleted integer;
begin
  with candidates as (
    select id
    from public.privacy_verification_account_cleanups
    where status='COMPLETED'
      and retention_until<=p_now
    order by retention_until,id
    for update skip locked
    limit least(greatest(coalesce(p_limit,500),1),1000)
  ),
  deleted as (
    delete from public.privacy_verification_account_cleanups cleanup
    using candidates
    where cleanup.id=candidates.id
    returning cleanup.id
  )
  select count(*)::integer into v_deleted from deleted;
  return v_deleted;
end;
$$;

create or replace function public.purge_privacy_verification_cleanup_subject_atomic(
  p_request_id uuid,
  p_operator_email text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_request public.privacy_requests_v2;
  v_email_hash text;
  v_pending integer;
  v_deleted integer;
  v_waiting integer;
  v_disposition text;
begin
  select * into v_request
    from public.privacy_requests_v2
    where id=p_request_id
    for update;
  if v_request.id is null
     or v_request.request_type<>'DELETION'
     or v_request.identity_verified_at is null then
    raise exception 'Verified deletion request required';
  end if;

  v_email_hash:=encode(
    extensions.digest(
      convert_to(lower(trim(v_request.email)),'UTF8'),
      'sha256'::text
    ),
    'hex'
  );
  -- A pending queue row is the durable guarantee that the external Auth
  -- account will be removed. Never delete that guarantee as part of the
  -- database-only subject purge; make it immediately eligible instead.
  update public.privacy_verification_account_cleanups
    set cleanup_after=least(cleanup_after,p_now)
    where (request_id=p_request_id or email_hash=v_email_hash)
      and status in ('PENDING','FAILED');
  get diagnostics v_pending=row_count;

  delete from public.privacy_verification_account_cleanups cleanup
  where (cleanup.request_id=p_request_id or cleanup.email_hash=v_email_hash)
    and cleanup.status='COMPLETED'
    and (
      cleanup.disposition in ('DELETED','ALREADY_ABSENT')
      or exists(
        select 1
        from public.privacy_account_deletions account_cleanup
        where account_cleanup.auth_user_id=cleanup.auth_user_id
          and account_cleanup.status='COMPLETED'
      )
    );
  get diagnostics v_deleted=row_count;

  select count(*)::integer into v_waiting
    from public.privacy_verification_account_cleanups cleanup
    where (cleanup.request_id=p_request_id or cleanup.email_hash=v_email_hash)
      and cleanup.status='COMPLETED';
  v_disposition:=case
    when v_pending>0 then 'PENDING'
    when v_waiting>0 then 'AWAITING_ACCOUNT_DELETION'
    when v_deleted>0 then 'PURGED'
    else 'ABSENT'
  end;

  perform public.record_operator_action(
    p_operator_email,
    'PURGE_PRIVACY_VERIFICATION_CLEANUP',
    'privacy_request',
    p_request_id::text,
    jsonb_build_object(
      'pendingCount',v_pending,
      'purgedCount',v_deleted,
      'awaitingAccountDeletionCount',v_waiting,
      'disposition',v_disposition,
      'processedAt',p_now
    )
  );
  return jsonb_build_object(
    'pendingCount',v_pending,
    'purgedCount',v_deleted,
    'awaitingAccountDeletionCount',v_waiting,
    'disposition',v_disposition
  );
end;
$$;

-- Extend the existing account/record/demo deletion transaction to cover the
-- minimized verification-cleanup records for the same verified subject.
create or replace function public.schedule_privacy_deletion_with_demo_atomic(
  p_request_id uuid,
  p_operator_email text,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_record_count integer;
  v_demo_request_count integer;
  v_verification_cleanup jsonb;
begin
  v_record_count:=public.schedule_privacy_deletion_atomic(
    p_request_id,
    p_operator_email,
    p_now
  );
  v_demo_request_count:=public.purge_demo_request_subject_atomic(
    p_request_id,
    p_operator_email,
    p_now
  );
  v_verification_cleanup:=
    public.purge_privacy_verification_cleanup_subject_atomic(
      p_request_id,
      p_operator_email,
      p_now
    );
  return jsonb_build_object(
    'recordCount',v_record_count,
    'demoRequestCount',v_demo_request_count,
    'verificationCleanup',v_verification_cleanup
  );
end;
$$;

revoke all on function public.queue_privacy_verification_account_cleanup_atomic(
  uuid,uuid,text,timestamptz,timestamptz
) from public,anon,authenticated;
revoke all on function public.complete_privacy_email_verification_atomic(
  text,text,text,uuid,timestamptz,boolean
) from public,anon,authenticated;
revoke all on function public.purge_completed_privacy_verification_cleanups_atomic(
  timestamptz,integer
) from public,anon,authenticated;
revoke all on function public.purge_expired_privacy_requests_atomic(
  timestamptz,integer
) from public,anon,authenticated;
revoke all on function public.purge_privacy_verification_cleanup_subject_atomic(
  uuid,text,timestamptz
) from public,anon,authenticated;
revoke all on function public.schedule_privacy_deletion_with_demo_atomic(
  uuid,text,timestamptz
) from public,anon,authenticated;
revoke all on function public.enforce_beta_invite_removal_retention()
  from public,anon,authenticated;
revoke all on function public.enforce_privacy_account_deletion_lifecycle()
  from public,anon,authenticated;

grant execute on function public.queue_privacy_verification_account_cleanup_atomic(
  uuid,uuid,text,timestamptz,timestamptz
) to service_role;
grant execute on function public.complete_privacy_email_verification_atomic(
  text,text,text,uuid,timestamptz,boolean
) to service_role;
grant execute on function public.purge_completed_privacy_verification_cleanups_atomic(
  timestamptz,integer
) to service_role;
grant execute on function public.purge_expired_privacy_requests_atomic(
  timestamptz,integer
) to service_role;
grant execute on function public.purge_privacy_verification_cleanup_subject_atomic(
  uuid,text,timestamptz
) to service_role;
grant execute on function public.schedule_privacy_deletion_with_demo_atomic(
  uuid,text,timestamptz
) to service_role;

insert into public.app_schema_versions(version,description)
values(
  '202607260005',
  'Minimized privacy/Auth cleanup, bounded deletion retries, and released-hold finalization'
)
on conflict(version) do update
set description=excluded.description,
    applied_at=clock_timestamp();
