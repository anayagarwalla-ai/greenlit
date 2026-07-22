-- Serialize the remaining beta-release races found by the 2026-07-22
-- independent production audit. Every admission path locks the account's
-- invite before business rows; retention and legal holds lock records before
-- evidence; recoverable pre-creation Stripe failures may safely replace a
-- customer selection without changing a job after a remote invoice exists.

update public.beta_feedback set email=lower(trim(email)) where email is not null and email<>lower(trim(email));
update public.privacy_requests_v2 set email=lower(trim(email)) where email<>lower(trim(email));
update public.privacy_account_deletions set email=lower(trim(email)) where email<>lower(trim(email));
update public.review_packets_v2 set reviewer_email=lower(trim(reviewer_email)) where reviewer_email is not null and reviewer_email<>lower(trim(reviewer_email));
update public.record_invoice_plans set billing_email=lower(trim(billing_email)) where billing_email<>lower(trim(billing_email));
update public.record_invoices set billing_email=lower(trim(billing_email)) where billing_email<>lower(trim(billing_email));
update public.beta_invites set email=lower(trim(email)) where email<>lower(trim(email));

alter table public.invoice_jobs add column if not exists failure_code text;
alter table public.invoice_jobs drop constraint if exists invoice_jobs_failure_code_check;
alter table public.invoice_jobs add constraint invoice_jobs_failure_code_check
  check(failure_code is null or failure_code in ('CUSTOMER_SELECTION_REQUIRED','PROCESSING_FAILED'));

-- This function deliberately takes a row lock. Holding that lock until the
-- caller commits means an operator removal and a newly admitted transaction
-- cannot both win.
create or replace function public.owner_beta_active_locked(p_owner_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,auth as $$
declare v_status text;
begin
  select b.status into v_status
  from auth.users u join public.beta_invites b on lower(b.email)=lower(u.email)
  where u.id=p_owner_user_id
  for update of b;
  return coalesce(v_status='ACTIVE',false);
end;
$$;

create or replace function public.queue_verification_job_idempotent_atomic(
  p_record_id uuid,p_record_public_id text,p_owner_user_id uuid,p_owner_token_hash text,p_mode text,
  p_agency_name text,p_client_name text,p_project_name text,p_milestone_title text,p_amount_minor bigint,
  p_currency text,p_source_name text,p_source_sha256 text,p_criteria jsonb,p_criteria_sha256 text,
  p_target_origin text,p_build_url text,p_build_label text,p_checks jsonb,p_runner_version text,
  p_workspace_state jsonb,p_actor_hash text,p_notice_version text,p_origin_addresses jsonb,p_request_key text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing public.verification_jobs_v2; v_existing_record public.transaction_records; v_queued jsonb;
begin
  if not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  if p_request_key is null or p_request_key !~ '^[0-9a-fA-F-]{36}$' then raise exception 'A valid run request key is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key,0));
  select * into v_existing from public.verification_jobs_v2 where request_key=p_request_key for update;
  if v_existing.id is not null then
    select * into v_existing_record from public.transaction_records where id=v_existing.record_id;
    if v_existing_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Run request key belongs to another owner'; end if;
    return jsonb_build_object('recordId',v_existing.record_id,'recordPublicId',v_existing_record.public_id,'jobId',v_existing.id,
      'criteriaRevision',v_existing.criteria_revision,'status',v_existing.status,'reused',true);
  end if;
  v_queued:=public.queue_verification_job_atomic(p_record_id,p_record_public_id,p_owner_user_id,p_owner_token_hash,p_mode,
    p_agency_name,p_client_name,p_project_name,p_milestone_title,p_amount_minor,p_currency,p_source_name,p_source_sha256,
    p_criteria,p_criteria_sha256,p_target_origin,p_build_url,p_build_label,p_checks,p_runner_version,p_workspace_state,
    p_actor_hash,p_notice_version,p_origin_addresses);
  update public.verification_jobs_v2 set request_key=p_request_key where id=(v_queued->>'jobId')::uuid;
  return v_queued||jsonb_build_object('status','QUEUED','reused',false);
end;
$$;

create or replace function public.create_review_packet_atomic(
  p_record_id uuid,p_run_id uuid,p_public_id text,p_snapshot jsonb,p_snapshot_sha256 text,
  p_bearer_token_hash text,p_expires_at timestamptz,p_actor_hash text,p_criteria_revision integer
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_packet_id uuid; v_record public.transaction_records; v_run public.verification_jobs_v2; v_owner_user_id uuid;
begin
  select owner_user_id into v_owner_user_id from public.transaction_records where id=p_record_id;
  if v_owner_user_id is null or not public.owner_beta_active_locked(v_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_record from public.transaction_records where id=p_record_id for update;
  select * into v_run from public.verification_jobs_v2 where id=p_run_id and record_id=p_record_id for update;
  if v_record.id is null or v_run.id is null or v_record.owner_user_id is distinct from v_owner_user_id then raise exception 'Record or run not found'; end if;
  if v_record.status not in ('READY_FOR_REVIEW','IN_REVIEW') or v_record.last_run_id is distinct from p_run_id then raise exception 'Only the current reviewable run may be shared'; end if;
  if exists(select 1 from public.review_packets_v2 where record_id=p_record_id and decision is null and revoked_at is null and expires_at>clock_timestamp()) then raise exception 'An active review link already exists'; end if;
  if v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_record.criteria_revision or p_criteria_revision<>v_record.criteria_revision then raise exception 'Run criteria revision is stale'; end if;
  if p_snapshot->>'recordId'<>p_record_id::text or p_snapshot#>>'{run,runId}'<>p_run_id::text or (p_snapshot->>'revision')::integer<>v_record.criteria_revision then raise exception 'Review snapshot does not match current record'; end if;
  update public.review_packets_v2 set revoked_at=coalesce(revoked_at,clock_timestamp()) where record_id=p_record_id and decision is null;
  insert into public.review_packets_v2(record_id,run_id,public_id,snapshot,snapshot_sha256,bearer_token_hash,expires_at,criteria_revision)
  values(p_record_id,p_run_id,p_public_id,p_snapshot,p_snapshot_sha256,p_bearer_token_hash,p_expires_at,p_criteria_revision) returning id into v_packet_id;
  update public.transaction_records set status='IN_REVIEW' where id=p_record_id;
  perform public.append_transaction_event(p_record_id,'REVIEW_PACKET_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetPublicId',p_public_id,'runId',p_run_id,'criteriaRevision',p_criteria_revision,'snapshotSha256',p_snapshot_sha256,'expiresAt',p_expires_at));
  return v_packet_id;
end;
$$;

create or replace function public.save_invoice_plan_atomic(
  p_record_id uuid,p_owner_user_id uuid,p_stripe_customer_id text,p_billing_name text,p_billing_email text,
  p_days_until_due integer,p_memo text,p_auto_send boolean,p_amount_minor bigint,p_currency text,
  p_criteria_revision integer,p_plan_sha256 text,p_actor_hash text
) returns public.record_invoice_plans language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records; v_plan public.record_invoice_plans; v_job public.invoice_jobs; v_can_correct boolean:=false;
begin
  if not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Milestone not found'; end if;
  if v_record.status='IN_REVIEW' then raise exception 'Invoice details are frozen while client review is active'; end if;
  if v_record.status not in ('READY_FOR_REVIEW','APPROVED') then raise exception 'Finish verification before configuring an invoice'; end if;
  if v_record.status='APPROVED' and p_auto_send then raise exception 'Automatic sending must be configured before client review'; end if;
  if p_amount_minor<>v_record.amount_minor or upper(p_currency)<>v_record.currency or p_criteria_revision<>v_record.criteria_revision then raise exception 'Invoice details do not match the current milestone revision'; end if;
  select j.* into v_job from public.invoice_jobs j where j.record_id=p_record_id order by j.created_at desc limit 1 for update;
  if v_job.id is not null and v_job.plan->>'planSha256' is distinct from p_plan_sha256 then
    v_can_correct:=v_job.status='FAILED' and v_job.failure_code='CUSTOMER_SELECTION_REQUIRED'
      and not exists(select 1 from public.record_invoices i where i.packet_id=v_job.packet_id);
    if not v_can_correct then raise exception 'Invoice details cannot change after a send attempt; resolve the existing invoice job first'; end if;
  end if;
  insert into public.record_invoice_plans(record_id,owner_user_id,stripe_customer_id,billing_name,billing_email,days_until_due,memo,auto_send,amount_minor,currency,criteria_revision,plan_sha256)
  values(p_record_id,p_owner_user_id,nullif(trim(p_stripe_customer_id),''),trim(p_billing_name),lower(trim(p_billing_email)),p_days_until_due,trim(p_memo),p_auto_send,p_amount_minor,upper(p_currency),p_criteria_revision,p_plan_sha256)
  on conflict(record_id) do update set stripe_customer_id=excluded.stripe_customer_id,billing_name=excluded.billing_name,billing_email=excluded.billing_email,
    days_until_due=excluded.days_until_due,memo=excluded.memo,auto_send=excluded.auto_send,amount_minor=excluded.amount_minor,currency=excluded.currency,
    criteria_revision=excluded.criteria_revision,plan_sha256=excluded.plan_sha256 returning * into v_plan;
  if v_can_correct then
    update public.invoice_jobs set plan=jsonb_build_object('enabled',true,'billingName',v_plan.billing_name,'billingEmail',v_plan.billing_email,
      'daysUntilDue',v_plan.days_until_due,'memo',v_plan.memo,'autoSend',false,'stripeCustomerId',v_plan.stripe_customer_id,
      'amountMinor',v_plan.amount_minor,'currency',v_plan.currency,'criteriaRevision',v_plan.criteria_revision,'planSha256',v_plan.plan_sha256),
      idempotency_prefix='greenlit:'||(select public_id from public.review_packets_v2 where id=v_job.packet_id)||':'||v_plan.plan_sha256,
      last_error=null,failure_code=null,claimed_at=null where id=v_job.id;
  end if;
  perform public.append_transaction_event(p_record_id,'INVOICE_PLAN_SAVED','OWNER',p_actor_hash,
    jsonb_build_object('planSha256',p_plan_sha256,'autoSend',p_auto_send,'amountMinor',p_amount_minor,'currency',upper(p_currency),'correctedFailedJob',v_can_correct));
  return v_plan;
end;
$$;

create or replace function public.queue_approved_invoice_job_atomic(p_packet_id uuid,p_owner_user_id uuid,p_actor_hash text)
returns public.invoice_jobs language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_plan_row public.record_invoice_plans; v_plan jsonb; v_job public.invoice_jobs;
begin
  if not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null or v_packet.decision<>'APPROVED' then raise exception 'An approved review packet is required'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Invoice owner mismatch'; end if;
  select * into v_plan_row from public.record_invoice_plans where record_id=v_record.id and owner_user_id=p_owner_user_id for update;
  if v_plan_row.record_id is null then raise exception 'Configure invoice details before sending'; end if;
  if v_plan_row.amount_minor<>v_record.amount_minor or v_plan_row.currency<>v_record.currency or v_plan_row.criteria_revision<>v_record.criteria_revision then raise exception 'Invoice details are stale; review and save them again'; end if;
  v_plan:=jsonb_build_object('enabled',true,'billingName',v_plan_row.billing_name,'billingEmail',v_plan_row.billing_email,
    'daysUntilDue',v_plan_row.days_until_due,'memo',v_plan_row.memo,'autoSend',false,'stripeCustomerId',v_plan_row.stripe_customer_id,
    'amountMinor',v_plan_row.amount_minor,'currency',v_plan_row.currency,'criteriaRevision',v_plan_row.criteria_revision,'planSha256',v_plan_row.plan_sha256);
  select * into v_job from public.invoice_jobs where packet_id=v_packet.id for update;
  if v_job.id is null then
    insert into public.invoice_jobs(packet_id,record_id,owner_user_id,plan,idempotency_prefix)
    values(v_packet.id,v_record.id,v_record.owner_user_id,v_plan,'greenlit:'||v_packet.public_id||':'||v_plan_row.plan_sha256) returning * into v_job;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_QUEUED','OWNER',p_actor_hash,jsonb_build_object('packetId',v_packet.public_id,'planSha256',v_plan_row.plan_sha256,'automatic',false));
  elsif v_job.status='FAILED' then
    if v_job.plan->>'planSha256' is distinct from v_plan_row.plan_sha256 then raise exception 'Invoice details cannot change after a send attempt; resolve the existing invoice job first'; end if;
    update public.invoice_jobs set status='PENDING',last_error=null,failure_code=null,claimed_at=null where id=v_job.id returning * into v_job;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_RETRIED','OWNER',p_actor_hash,jsonb_build_object('packetId',v_packet.public_id,'jobId',v_job.id));
  end if;
  return v_job;
end;
$$;

create or replace function public.remove_invoice_plan_atomic(p_record_id uuid,p_owner_user_id uuid,p_actor_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records; v_plan public.record_invoice_plans;
begin
  if not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Milestone not found'; end if;
  if v_record.status='IN_REVIEW' then raise exception 'Invoice details are frozen while client review is active'; end if;
  if exists(select 1 from public.invoice_jobs where record_id=p_record_id) then raise exception 'Invoice details cannot be removed after a send attempt'; end if;
  delete from public.record_invoice_plans where record_id=p_record_id and owner_user_id=p_owner_user_id returning * into v_plan;
  if v_plan.record_id is null then return false; end if;
  perform public.append_transaction_event(p_record_id,'INVOICE_PLAN_REMOVED','OWNER',p_actor_hash,jsonb_build_object('planSha256',v_plan.plan_sha256));
  return true;
end;
$$;

create or replace function public.claim_invoice_job_atomic(p_job_id uuid,p_owner_user_id uuid,p_now timestamptz)
returns public.invoice_jobs language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs;
begin
  if not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'The invoice owner is no longer an active beta account'; end if;
  update public.invoice_jobs set status='PROCESSING',attempts=attempts+1,claimed_at=p_now,last_error=null,failure_code=null
  where id=p_job_id and owner_user_id=p_owner_user_id and (status in ('PENDING','FAILED') or (status='PROCESSING' and claimed_at<p_now-interval '10 minutes')) returning * into v_job;
  return v_job;
end;
$$;

create or replace function public.fail_invoice_job_atomic(p_job_id uuid,p_error text,p_failed_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs; v_failure_code text;
begin
  v_failure_code:=case when p_error='Multiple Stripe customers use this email. Select the correct customer before retrying.'
    or p_error like 'The selected Stripe customer no longer matches%' then 'CUSTOMER_SELECTION_REQUIRED' else 'PROCESSING_FAILED' end;
  update public.invoice_jobs set status='FAILED',last_error=left(p_error,1000),failure_code=v_failure_code,claimed_at=null
  where id=p_job_id and status='PROCESSING' returning * into v_job;
  if v_job.id is null then return false; end if;
  update public.record_invoices set last_error=left(p_error,1000) where packet_id=v_job.packet_id;
  perform public.append_transaction_event(v_job.record_id,'INVOICE_SEND_FAILED','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'error',left(p_error,500),'failureCode',v_failure_code,'failedAt',p_failed_at));
  return true;
end;
$$;

-- Record -> evidence is the single lock order used by both staging and holds.
create or replace function public.stage_expired_evidence_deletion(p_limit integer,p_now timestamptz)
returns table(id uuid,record_id uuid,storage_path text) language plpgsql security definer set search_path=public as $$
declare v_candidate record; v_record public.transaction_records; v_evidence public.evidence_artifacts_v2; v_count integer:=0;
begin
  for v_candidate in
    select e.id,e.record_id from public.evidence_artifacts_v2 e join public.transaction_records r on r.id=e.record_id
    where e.expires_at<=p_now and not e.legal_hold and not r.legal_hold and e.deletion_status in ('ACTIVE','FAILED') and r.deletion_status='ACTIVE'
    order by e.expires_at,e.id limit greatest(1,least(p_limit,500))
  loop
    v_record:=null; v_evidence:=null;
    select * into v_record from public.transaction_records r where r.id=v_candidate.record_id for update skip locked;
    if v_record.id is null or v_record.legal_hold or v_record.deletion_status<>'ACTIVE' then continue; end if;
    select * into v_evidence from public.evidence_artifacts_v2 e where e.id=v_candidate.id for update skip locked;
    if v_evidence.id is null or v_evidence.record_id<>v_record.id or v_evidence.legal_hold or v_evidence.expires_at>p_now or v_evidence.deletion_status not in ('ACTIVE','FAILED') then continue; end if;
    update public.evidence_artifacts_v2 e set deletion_status='PENDING',deletion_requested_at=p_now,deletion_error=null where e.id=v_evidence.id;
    perform public.append_transaction_event(v_record.id,'EVIDENCE_DELETION_STAGED','SYSTEM',null,jsonb_build_object('artifactId',v_evidence.id,'processedAt',p_now));
    id:=v_evidence.id; record_id:=v_record.id; storage_path:=v_evidence.storage_path; return next;
    v_count:=v_count+1; if v_count>=greatest(1,least(p_limit,500)) then exit; end if;
  end loop;
end;
$$;

create or replace function public.set_privacy_legal_hold_atomic(p_request_id uuid,p_enabled boolean,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2; v_record_id uuid; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null then raise exception 'Privacy request not found'; end if;
  if v_request.identity_verified_at is null then raise exception 'Verify the requester before changing legal holds'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  for v_record_id in select record_id from public.privacy_subject_record_ids(v_request.email) order by record_id loop
    perform 1 from public.transaction_records where id=v_record_id for update;
    perform 1 from public.evidence_artifacts_v2 where record_id=v_record_id order by id for update;
    if p_enabled then
      if exists(select 1 from public.transaction_records where id=v_record_id and deletion_status='PENDING')
        or exists(select 1 from public.evidence_artifacts_v2 where record_id=v_record_id and deletion_status='PENDING') then raise exception 'Deletion is already in progress for a matched record'; end if;
      insert into public.legal_holds_v2(record_id,privacy_request_id,reason,owner_email,review_at)
      values(v_record_id,p_request_id,'Privacy request '||v_request.public_id,p_operator_email,p_now+interval '90 days')
      on conflict(record_id,privacy_request_id) where active do nothing;
    else
      update public.legal_holds_v2 set active=false,released_at=p_now,released_by=p_operator_email where record_id=v_record_id and privacy_request_id=p_request_id and active;
    end if;
    update public.transaction_records set legal_hold=exists(select 1 from public.legal_holds_v2 h where h.record_id=v_record_id and h.active) where id=v_record_id;
    update public.evidence_artifacts_v2 set legal_hold=exists(select 1 from public.legal_holds_v2 h where h.record_id=v_record_id and h.active) where record_id=v_record_id;
    perform public.append_transaction_event(v_record_id,case when p_enabled then 'LEGAL_HOLD_APPLIED' else 'LEGAL_HOLD_RELEASED' end,'SYSTEM',v_actor_hash,
      jsonb_build_object('privacyRequestId',v_request.public_id,'occurredAt',p_now));
    v_count:=v_count+1;
  end loop;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id and status not in ('COMPLETED','DENIED');
  perform public.record_operator_action(p_operator_email,case when p_enabled then 'APPLY_PRIVACY_LEGAL_HOLD' else 'RELEASE_PRIVACY_LEGAL_HOLD' end,
    'privacy_request',p_request_id::text,jsonb_build_object('recordCount',v_count));
  return v_count;
end;
$$;

create or replace function public.manage_beta_invite_atomic(p_email text,p_status text,p_responsible_operator text,p_operator_email text,p_now timestamptz)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_id uuid; v_owner_id uuid; v_job public.verification_jobs_v2; v_email text:=lower(trim(p_email));
begin
  if p_status not in ('ACTIVE','REMOVED') or nullif(v_email,'') is null or nullif(trim(p_responsible_operator),'') is null then raise exception 'Invalid beta invitation update'; end if;
  -- Existing admissions lock this same invite row before touching business rows.
  perform 1 from public.beta_invites where email=v_email for update;
  select id into v_owner_id from auth.users where lower(email)=v_email limit 1;
  if p_status='REMOVED' and v_owner_id is not null then perform 1 from public.invoice_jobs where owner_user_id=v_owner_id for update; end if;
  if p_status='REMOVED' and v_owner_id is not null and exists(select 1 from public.invoice_jobs where owner_user_id=v_owner_id and status='PROCESSING') then raise exception 'Resolve the processing invoice job before removing this account'; end if;
  insert into public.beta_invites(email,status,adult_sponsor,invited_by,invited_at,removed_at)
  values(v_email,p_status,trim(p_responsible_operator),p_operator_email,p_now,case when p_status='REMOVED' then p_now else null end)
  on conflict(email) do update set status=excluded.status,adult_sponsor=excluded.adult_sponsor,invited_by=excluded.invited_by,removed_at=excluded.removed_at returning id into v_id;
  if p_status='REMOVED' and v_owner_id is not null then
    update public.review_packets_v2 set revoked_at=coalesce(revoked_at,p_now) where decision is null and record_id in(select id from public.transaction_records where owner_user_id=v_owner_id);
    update public.invoice_jobs set status='CANCELLED',last_error='Cancelled because the beta account was removed.',failure_code=null,claimed_at=null where owner_user_id=v_owner_id and status in ('PENDING','FAILED');
    update public.stripe_connections set status='DISCONNECTED',access_token_ciphertext=null,refresh_token_ciphertext=null,access_token_expires_at=null,
      refresh_claim_id=null,refresh_claimed_at=null,disconnected_at=p_now,last_error=null where owner_user_id=v_owner_id;
    for v_job in select * from public.verification_jobs_v2 where record_id in(select id from public.transaction_records where owner_user_id=v_owner_id)
      and status in ('QUEUED','LEASED','RUNNING') for update loop
      update public.verification_jobs_v2 set status='EXPIRED',last_error='Cancelled because the beta account was removed.',completed_at=p_now where id=v_job.id;
      update public.transaction_records set status='READY',active_job_id=null where id=v_job.record_id and active_job_id=v_job.id;
      perform public.append_transaction_event(v_job.record_id,'VERIFICATION_CANCELLED','SYSTEM',null,jsonb_build_object('jobId',v_job.id,'reason','Beta account removed'));
    end loop;
  end if;
  perform public.record_operator_action(p_operator_email,case when p_status='ACTIVE' then 'ACTIVATE_BETA_INVITE' else 'REMOVE_BETA_INVITE' end,
    'beta_invite',v_id::text,jsonb_build_object('email',v_email,'responsibleOperator',trim(p_responsible_operator)));
  return v_id;
end;
$$;

create or replace function public.mint_receipt_session_atomic(p_packet_id uuid,p_owner_user_id uuid,p_session_hash text,p_expires_at timestamptz,p_actor_hash text)
returns text language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_actual_owner uuid;
begin
  select r.owner_user_id into v_actual_owner from public.review_packets_v2 p join public.transaction_records r on r.id=p.record_id where p.id=p_packet_id;
  if v_actual_owner is distinct from p_owner_user_id or not public.owner_beta_active_locked(p_owner_user_id) then raise exception 'Receipt owner mismatch or inactive account'; end if;
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null or v_packet.decision<>'APPROVED' then raise exception 'An approved decision is required'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Receipt owner mismatch'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '30 days' then raise exception 'Receipt-link expiry is invalid'; end if;
  insert into public.receipt_sessions_v2(packet_id,session_hash,expires_at) values(v_packet.id,p_session_hash,p_expires_at);
  perform public.append_transaction_event(v_record.id,'RECEIPT_LINK_CREATED','OWNER',p_actor_hash,jsonb_build_object('packetId',v_packet.public_id,'expiresAt',p_expires_at));
  return v_packet.public_id;
end;
$$;

create or replace function public.record_review_decision_with_notification_atomic(
  p_packet_id uuid,p_decision text,p_reviewer_name text,p_reviewer_email text,p_reviewer_note text,p_notice_version text,
  p_actor_hash text,p_country_code text,p_decided_at timestamptz,p_receipt_sha256 text,p_delivery_status text,
  p_receipt_session_hash text,p_receipt_session_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_run public.verification_jobs_v2; v_notification_id uuid; v_event public.transaction_audit_events; v_invoice_job_id uuid; v_owner_user_id uuid;
begin
  if p_decision not in ('APPROVED','CHANGES_REQUESTED') then raise exception 'Invalid decision'; end if;
  if p_delivery_status not in ('IN_APP','PENDING_EMAIL') then raise exception 'Invalid notification delivery status'; end if;
  select r.owner_user_id into v_owner_user_id from public.review_packets_v2 p join public.transaction_records r on r.id=p.record_id where p.id=p_packet_id;
  if v_owner_user_id is null or not public.owner_beta_active_locked(v_owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from v_owner_user_id then raise exception 'Review owner changed'; end if;
  select * into v_run from public.verification_jobs_v2 where id=v_packet.run_id for update;
  if v_packet.decision is not null then raise exception 'Decision already recorded'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=now() then raise exception 'Review packet unavailable'; end if;
  if v_record.status<>'IN_REVIEW' or v_record.last_run_id is distinct from v_packet.run_id or v_record.criteria_revision<>v_packet.criteria_revision
    or v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_packet.criteria_revision then raise exception 'Review packet is stale'; end if;
  update public.review_packets_v2 set decision=p_decision,reviewer_name=p_reviewer_name,reviewer_email=lower(trim(p_reviewer_email)),
    reviewer_note=nullif(p_reviewer_note,''),intent_confirmed=true,legal_terms_accepted=true,electronic_records_consent=true,
    notice_version=p_notice_version,actor_hash=p_actor_hash,country_code=p_country_code,decided_at=p_decided_at where id=p_packet_id;
  update public.transaction_records set status=case when p_decision='APPROVED' then 'APPROVED' else 'CHANGES_REQUESTED' end where id=v_packet.record_id;
  select * into v_event from public.append_transaction_event(v_packet.record_id,case when p_decision='APPROVED' then 'MILESTONE_APPROVED' else 'CHANGES_REQUESTED' end,'REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'runId',v_packet.run_id,'criteriaRevision',v_packet.criteria_revision,'snapshotSha256',v_packet.snapshot_sha256,
      'reviewerName',p_reviewer_name,'reviewerEmail',lower(trim(p_reviewer_email)),'reviewerNote',p_reviewer_note,'intentConfirmed',true,
      'legalTermsAccepted',true,'electronicRecordsConsent',true,'noticeVersion',p_notice_version,'decidedAt',p_decided_at));
  update public.review_packets_v2 set receipt_sha256=v_event.event_hash,decision_event_hash=v_event.event_hash where id=p_packet_id;
  if p_decision='APPROVED' and coalesce(v_packet.snapshot#>>'{invoicePlan,enabled}','false')='true' and coalesce(v_packet.snapshot#>>'{invoicePlan,autoSend}','false')='true' then
    insert into public.invoice_jobs(packet_id,record_id,owner_user_id,plan,idempotency_prefix)
    values(v_packet.id,v_record.id,v_record.owner_user_id,v_packet.snapshot->'invoicePlan','greenlit:'||v_packet.public_id||':'||coalesce(v_packet.snapshot#>>'{invoicePlan,planSha256}','plan'))
    on conflict(packet_id) do update set plan=excluded.plan returning id into v_invoice_job_id;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_QUEUED','SYSTEM',null,jsonb_build_object('packetId',v_packet.public_id,'jobId',v_invoice_job_id,'planSha256',v_packet.snapshot#>>'{invoicePlan,planSha256}','automatic',true));
  end if;
  if v_record.owner_user_id is not null then
    insert into public.operator_notifications(owner_user_id,record_id,event_type,title,body,payload,delivery_status)
    values(v_record.owner_user_id,v_record.id,p_decision,case when p_decision='APPROVED' then v_record.milestone_title||' was approved' else v_record.client_name||' requested changes' end,
      p_reviewer_name||case when p_decision='APPROVED' then ' recorded approval. Open the agency dashboard for the retained record.' else ' requested changes. Open the agency dashboard for the retained record.' end,
      jsonb_build_object('packetId',v_packet.public_id,'reviewerEmail',lower(trim(p_reviewer_email)),'decidedAt',p_decided_at,'invoiceJobId',v_invoice_job_id),p_delivery_status) returning id into v_notification_id;
  end if;
  insert into public.receipt_sessions_v2(packet_id,session_hash,expires_at) values(v_packet.id,p_receipt_session_hash,p_receipt_session_expires_at);
  return jsonb_build_object('recordId',v_record.id,'notificationId',v_notification_id,'receiptSha256',v_event.event_hash,'auditSequence',v_event.sequence,'invoiceJobId',v_invoice_job_id);
end;
$$;

revoke all on function public.owner_beta_active_locked(uuid) from public,anon,authenticated;
grant execute on function public.owner_beta_active_locked(uuid) to service_role;

insert into public.app_schema_versions(version,description)
values('202607220002','Serialized legal holds, retention, offboarding, and recoverable invoice correction')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
