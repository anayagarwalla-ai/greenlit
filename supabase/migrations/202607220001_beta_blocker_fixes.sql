-- Close the remaining external-beta state, billing, privacy, and retention
-- failure paths found by the 2026-07-22 independent audit.

alter table public.verification_jobs_v2
  add column if not exists request_key text;
create unique index if not exists verification_jobs_v2_request_key_unique
  on public.verification_jobs_v2(request_key) where request_key is not null;

-- The runner captures JPEG evidence. Keep the storage contract reproducible
-- instead of relying on a bucket setting that was corrected by hand.
update storage.buckets
set allowed_mime_types = array['image/png','image/jpeg','image/webp','application/json','text/html','application/pdf']
where id = 'evidence';

create or replace function public.queue_verification_job_idempotent_atomic(
  p_record_id uuid,
  p_record_public_id text,
  p_owner_user_id uuid,
  p_owner_token_hash text,
  p_mode text,
  p_agency_name text,
  p_client_name text,
  p_project_name text,
  p_milestone_title text,
  p_amount_minor bigint,
  p_currency text,
  p_source_name text,
  p_source_sha256 text,
  p_criteria jsonb,
  p_criteria_sha256 text,
  p_target_origin text,
  p_build_url text,
  p_build_label text,
  p_checks jsonb,
  p_runner_version text,
  p_workspace_state jsonb,
  p_actor_hash text,
  p_notice_version text,
  p_origin_addresses jsonb,
  p_request_key text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.verification_jobs_v2;
  v_existing_record public.transaction_records;
  v_queued jsonb;
begin
  if p_request_key is null or p_request_key !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'A valid run request key is required';
  end if;

  -- The advisory lock makes the request key idempotent even when two retries
  -- arrive before either transaction commits.
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 0));
  select * into v_existing from public.verification_jobs_v2 where request_key=p_request_key for update;
  if v_existing.id is not null then
    select * into v_existing_record from public.transaction_records where id=v_existing.record_id;
    if v_existing_record.owner_user_id is distinct from p_owner_user_id then
      raise exception 'Run request key belongs to another owner';
    end if;
    return jsonb_build_object(
      'recordId',v_existing.record_id,'recordPublicId',v_existing_record.public_id,
      'jobId',v_existing.id,'criteriaRevision',v_existing.criteria_revision,
      'status',v_existing.status,'reused',true
    );
  end if;

  v_queued:=public.queue_verification_job_atomic(
    p_record_id,p_record_public_id,p_owner_user_id,p_owner_token_hash,p_mode,
    p_agency_name,p_client_name,p_project_name,p_milestone_title,p_amount_minor,
    p_currency,p_source_name,p_source_sha256,p_criteria,p_criteria_sha256,
    p_target_origin,p_build_url,p_build_label,p_checks,p_runner_version,
    p_workspace_state,p_actor_hash,p_notice_version,p_origin_addresses
  );
  update public.verification_jobs_v2 set request_key=p_request_key
    where id=(v_queued->>'jobId')::uuid;
  return v_queued || jsonb_build_object('status','QUEUED','reused',false);
end;
$$;

-- Manual sending always uses the owner's currently confirmed plan. The
-- snapshot remains authoritative only for automatic sending committed at the
-- instant of client approval.
create or replace function public.queue_approved_invoice_job_atomic(p_packet_id uuid,p_owner_user_id uuid,p_actor_hash text)
returns public.invoice_jobs language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_plan_row public.record_invoice_plans; v_plan jsonb; v_job public.invoice_jobs;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null or v_packet.decision<>'APPROVED' then raise exception 'An approved review packet is required'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Invoice owner mismatch'; end if;
  select * into v_plan_row from public.record_invoice_plans where record_id=v_record.id and owner_user_id=p_owner_user_id for update;
  if v_plan_row.record_id is null then raise exception 'Configure invoice details before sending'; end if;
  if v_plan_row.amount_minor<>v_record.amount_minor or v_plan_row.currency<>v_record.currency or v_plan_row.criteria_revision<>v_record.criteria_revision then
    raise exception 'Invoice details are stale; review and save them again';
  end if;
  v_plan:=jsonb_build_object('enabled',true,'billingName',v_plan_row.billing_name,'billingEmail',v_plan_row.billing_email,
    'daysUntilDue',v_plan_row.days_until_due,'memo',v_plan_row.memo,'autoSend',false,'stripeCustomerId',v_plan_row.stripe_customer_id,
    'amountMinor',v_plan_row.amount_minor,'currency',v_plan_row.currency,'criteriaRevision',v_plan_row.criteria_revision,'planSha256',v_plan_row.plan_sha256);
  select * into v_job from public.invoice_jobs where packet_id=v_packet.id for update;
  if v_job.id is null then
    insert into public.invoice_jobs(packet_id,record_id,owner_user_id,plan,idempotency_prefix)
    values(v_packet.id,v_record.id,v_record.owner_user_id,v_plan,'greenlit:'||v_packet.public_id||':'||v_plan_row.plan_sha256) returning * into v_job;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_QUEUED','OWNER',p_actor_hash,
      jsonb_build_object('packetId',v_packet.public_id,'planSha256',v_plan_row.plan_sha256,'automatic',false));
  elsif v_job.status='FAILED' then
    if v_job.plan->>'planSha256' is distinct from v_plan_row.plan_sha256 then
      raise exception 'Invoice details cannot change after a send attempt; resolve the existing invoice job first';
    end if;
    update public.invoice_jobs set status='PENDING',last_error=null,claimed_at=null where id=v_job.id returning * into v_job;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_RETRIED','OWNER',p_actor_hash,
      jsonb_build_object('packetId',v_packet.public_id,'jobId',v_job.id));
  end if;
  return v_job;
end;
$$;

create or replace function public.save_invoice_plan_atomic(
  p_record_id uuid,p_owner_user_id uuid,p_stripe_customer_id text,p_billing_name text,p_billing_email text,
  p_days_until_due integer,p_memo text,p_auto_send boolean,p_amount_minor bigint,p_currency text,
  p_criteria_revision integer,p_plan_sha256 text,p_actor_hash text
) returns public.record_invoice_plans language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records; v_plan public.record_invoice_plans; v_job public.invoice_jobs;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Milestone not found'; end if;
  if v_record.status='IN_REVIEW' then raise exception 'Invoice details are frozen while client review is active'; end if;
  if v_record.status not in ('READY_FOR_REVIEW','APPROVED') then raise exception 'Finish verification before configuring an invoice'; end if;
  if v_record.status='APPROVED' and p_auto_send then raise exception 'Automatic sending must be configured before client review'; end if;
  if p_amount_minor<>v_record.amount_minor or upper(p_currency)<>v_record.currency or p_criteria_revision<>v_record.criteria_revision then raise exception 'Invoice details do not match the current milestone revision'; end if;
  select j.* into v_job from public.invoice_jobs j where j.record_id=p_record_id order by j.created_at desc limit 1 for update;
  if v_job.id is not null and v_job.plan->>'planSha256' is distinct from p_plan_sha256 then
    raise exception 'Invoice details cannot change after a send attempt; resolve the existing invoice job first';
  end if;
  insert into public.record_invoice_plans(record_id,owner_user_id,stripe_customer_id,billing_name,billing_email,days_until_due,memo,auto_send,amount_minor,currency,criteria_revision,plan_sha256)
  values(p_record_id,p_owner_user_id,p_stripe_customer_id,trim(p_billing_name),lower(trim(p_billing_email)),p_days_until_due,trim(p_memo),p_auto_send,p_amount_minor,upper(p_currency),p_criteria_revision,p_plan_sha256)
  on conflict(record_id) do update set stripe_customer_id=excluded.stripe_customer_id,billing_name=excluded.billing_name,billing_email=excluded.billing_email,
    days_until_due=excluded.days_until_due,memo=excluded.memo,auto_send=excluded.auto_send,amount_minor=excluded.amount_minor,currency=excluded.currency,
    criteria_revision=excluded.criteria_revision,plan_sha256=excluded.plan_sha256
  returning * into v_plan;
  perform public.append_transaction_event(p_record_id,'INVOICE_PLAN_SAVED','OWNER',p_actor_hash,
    jsonb_build_object('planSha256',p_plan_sha256,'autoSend',p_auto_send,'amountMinor',p_amount_minor,'currency',upper(p_currency)));
  return v_plan;
end;
$$;

create or replace function public.remove_invoice_plan_atomic(p_record_id uuid,p_owner_user_id uuid,p_actor_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records; v_plan public.record_invoice_plans;
begin
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

alter table public.invoice_jobs drop constraint if exists invoice_jobs_status_check;
alter table public.invoice_jobs add constraint invoice_jobs_status_check
  check(status in ('PENDING','PROCESSING','FAILED','COMPLETED','CANCELLED'));

-- Released hold history follows the retained record. Active holds still block
-- staging, and staging blocks a new hold before any object-store deletion.
alter table public.legal_holds_v2 drop constraint if exists legal_holds_v2_record_id_fkey;
alter table public.legal_holds_v2 add constraint legal_holds_v2_record_id_fkey
  foreign key(record_id) references public.transaction_records(id) on delete cascade;

create or replace function public.set_privacy_legal_hold_atomic(p_request_id uuid,p_enabled boolean,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2; v_record_id uuid; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null then raise exception 'Privacy request not found'; end if;
  if v_request.identity_verified_at is null then raise exception 'Verify the requester before changing legal holds'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  for v_record_id in select record_id from public.privacy_subject_record_ids(v_request.email) loop
    if p_enabled then
      if exists(select 1 from public.transaction_records where id=v_record_id and deletion_status='PENDING')
         or exists(select 1 from public.evidence_artifacts_v2 where record_id=v_record_id and deletion_status='PENDING') then
        raise exception 'Deletion is already in progress for a matched record';
      end if;
      insert into public.legal_holds_v2(record_id,privacy_request_id,reason,owner_email,review_at)
      values(v_record_id,p_request_id,'Privacy request '||v_request.public_id,p_operator_email,p_now+interval '90 days')
      on conflict (record_id,privacy_request_id) where active do nothing;
    else
      update public.legal_holds_v2 set active=false,released_at=p_now,released_by=p_operator_email where record_id=v_record_id and privacy_request_id=p_request_id and active;
    end if;
    update public.transaction_records set legal_hold=exists(select 1 from public.legal_holds_v2 h where h.record_id=v_record_id and h.active) where id=v_record_id;
    update public.evidence_artifacts_v2 set legal_hold=exists(select 1 from public.legal_holds_v2 h where h.record_id=v_record_id and h.active) where record_id=v_record_id;
    perform public.append_transaction_event(v_record_id,case when p_enabled then 'LEGAL_HOLD_APPLIED' else 'LEGAL_HOLD_RELEASED' end,'SYSTEM',v_actor_hash,jsonb_build_object('privacyRequestId',v_request.public_id,'occurredAt',p_now));
    v_count:=v_count+1;
  end loop;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id and status not in ('COMPLETED','DENIED');
  perform public.record_operator_action(p_operator_email,case when p_enabled then 'APPLY_PRIVACY_LEGAL_HOLD' else 'RELEASE_PRIVACY_LEGAL_HOLD' end,'privacy_request',p_request_id::text,jsonb_build_object('recordCount',v_count));
  return v_count;
end;
$$;

create or replace function public.owner_beta_active(p_owner_user_id uuid)
returns boolean language sql security definer set search_path=public,auth stable as $$
  select exists(
    select 1 from auth.users u join public.beta_invites b on lower(b.email)=lower(u.email)
    where u.id=p_owner_user_id and b.status='ACTIVE'
  )
$$;

create or replace function public.manage_beta_invite_atomic(p_email text,p_status text,p_responsible_operator text,p_operator_email text,p_now timestamptz)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_id uuid; v_owner_id uuid; v_job public.verification_jobs_v2;
begin
  if p_status not in ('ACTIVE','REMOVED') or nullif(trim(p_email),'') is null or nullif(trim(p_responsible_operator),'') is null then raise exception 'Invalid beta invitation update'; end if;
  select id into v_owner_id from auth.users where lower(email)=lower(trim(p_email)) limit 1;
  if p_status='REMOVED' and v_owner_id is not null then
    perform 1 from public.invoice_jobs where owner_user_id=v_owner_id for update;
  end if;
  if p_status='REMOVED' and v_owner_id is not null and exists(select 1 from public.invoice_jobs where owner_user_id=v_owner_id and status='PROCESSING') then
    raise exception 'Resolve the processing invoice job before removing this account';
  end if;
  insert into public.beta_invites(email,status,adult_sponsor,invited_by,invited_at,removed_at)
  values(lower(trim(p_email)),p_status,trim(p_responsible_operator),p_operator_email,p_now,case when p_status='REMOVED' then p_now else null end)
  on conflict(email) do update set status=excluded.status,adult_sponsor=excluded.adult_sponsor,invited_by=excluded.invited_by,removed_at=excluded.removed_at
  returning id into v_id;
  if p_status='REMOVED' and v_owner_id is not null then
    update public.review_packets_v2 set revoked_at=coalesce(revoked_at,p_now)
      where decision is null and record_id in(select id from public.transaction_records where owner_user_id=v_owner_id);
    update public.invoice_jobs set status='CANCELLED',last_error='Cancelled because the beta account was removed.',claimed_at=null
      where owner_user_id=v_owner_id and status in ('PENDING','FAILED');
    update public.stripe_connections set status='DISCONNECTED',access_token_ciphertext=null,refresh_token_ciphertext=null,
      access_token_expires_at=null,refresh_claim_id=null,refresh_claimed_at=null,disconnected_at=p_now,last_error=null
      where owner_user_id=v_owner_id;
    for v_job in select * from public.verification_jobs_v2 where record_id in(select id from public.transaction_records where owner_user_id=v_owner_id) and status in ('QUEUED','LEASED','RUNNING') for update loop
      update public.verification_jobs_v2 set status='EXPIRED',last_error='Cancelled because the beta account was removed.',completed_at=p_now where id=v_job.id;
      update public.transaction_records set status='READY',active_job_id=null where id=v_job.record_id and active_job_id=v_job.id;
      perform public.append_transaction_event(v_job.record_id,'VERIFICATION_CANCELLED','SYSTEM',null,jsonb_build_object('jobId',v_job.id,'reason','Beta account removed'));
    end loop;
  end if;
  perform public.record_operator_action(p_operator_email,case when p_status='ACTIVE' then 'ACTIVATE_BETA_INVITE' else 'REMOVE_BETA_INVITE' end,'beta_invite',v_id::text,jsonb_build_object('email',lower(trim(p_email)),'responsibleOperator',trim(p_responsible_operator)));
  return v_id;
end;
$$;

create or replace function public.claim_invoice_job_atomic(p_job_id uuid,p_owner_user_id uuid,p_now timestamptz)
returns public.invoice_jobs language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs;
begin
  if not public.owner_beta_active(p_owner_user_id) then raise exception 'The invoice owner is no longer an active beta account'; end if;
  update public.invoice_jobs set status='PROCESSING',attempts=attempts+1,claimed_at=p_now,last_error=null
  where id=p_job_id and owner_user_id=p_owner_user_id
    and (status in ('PENDING','FAILED') or (status='PROCESSING' and claimed_at<p_now-interval '10 minutes'))
  returning * into v_job;
  return v_job;
end;
$$;

create or replace function public.mint_receipt_session_atomic(
  p_packet_id uuid,p_owner_user_id uuid,p_session_hash text,p_expires_at timestamptz,p_actor_hash text
) returns text language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null or v_packet.decision<>'APPROVED' then raise exception 'An approved decision is required'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Receipt owner mismatch'; end if;
  if p_expires_at<=now() or p_expires_at>now()+interval '30 days' then raise exception 'Receipt-link expiry is invalid'; end if;
  insert into public.receipt_sessions_v2(packet_id,session_hash,expires_at) values(v_packet.id,p_session_hash,p_expires_at);
  perform public.append_transaction_event(v_record.id,'RECEIPT_LINK_CREATED','OWNER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'expiresAt',p_expires_at));
  return v_packet.public_id;
end;
$$;

-- A decision must not reactivate a workflow after the agency has been removed.
create or replace function public.record_review_decision_with_notification_atomic(
  p_packet_id uuid,p_decision text,p_reviewer_name text,p_reviewer_email text,
  p_reviewer_note text,p_notice_version text,p_actor_hash text,p_country_code text,
  p_decided_at timestamptz,p_receipt_sha256 text,p_delivery_status text,
  p_receipt_session_hash text,p_receipt_session_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_run public.verification_jobs_v2; v_notification_id uuid; v_event public.transaction_audit_events; v_invoice_job_id uuid;
begin
  if p_decision not in ('APPROVED','CHANGES_REQUESTED') then raise exception 'Invalid decision'; end if;
  if p_delivery_status not in ('IN_APP','PENDING_EMAIL') then raise exception 'Invalid notification delivery status'; end if;
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if not public.owner_beta_active(v_record.owner_user_id) then raise exception 'The agency account is no longer active'; end if;
  select * into v_run from public.verification_jobs_v2 where id=v_packet.run_id for update;
  if v_packet.decision is not null then raise exception 'Decision already recorded'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=now() then raise exception 'Review packet unavailable'; end if;
  if v_record.status<>'IN_REVIEW' or v_record.last_run_id is distinct from v_packet.run_id or v_record.criteria_revision<>v_packet.criteria_revision or v_run.status<>'COMPLETED' or v_run.criteria_revision<>v_packet.criteria_revision then raise exception 'Review packet is stale'; end if;
  update public.review_packets_v2 set decision=p_decision,reviewer_name=p_reviewer_name,reviewer_email=p_reviewer_email,
    reviewer_note=nullif(p_reviewer_note,''),intent_confirmed=true,legal_terms_accepted=true,electronic_records_consent=true,notice_version=p_notice_version,
    actor_hash=p_actor_hash,country_code=p_country_code,decided_at=p_decided_at where id=p_packet_id;
  update public.transaction_records set status=case when p_decision='APPROVED' then 'APPROVED' else 'CHANGES_REQUESTED' end where id=v_packet.record_id;
  select * into v_event from public.append_transaction_event(v_packet.record_id,case when p_decision='APPROVED' then 'MILESTONE_APPROVED' else 'CHANGES_REQUESTED' end,'REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'runId',v_packet.run_id,'criteriaRevision',v_packet.criteria_revision,'snapshotSha256',v_packet.snapshot_sha256,
      'reviewerName',p_reviewer_name,'reviewerEmail',p_reviewer_email,'reviewerNote',p_reviewer_note,'intentConfirmed',true,'legalTermsAccepted',true,'electronicRecordsConsent',true,'noticeVersion',p_notice_version,'decidedAt',p_decided_at));
  update public.review_packets_v2 set receipt_sha256=v_event.event_hash,decision_event_hash=v_event.event_hash where id=p_packet_id;
  if p_decision='APPROVED' and coalesce(v_packet.snapshot#>>'{invoicePlan,enabled}','false')='true' and coalesce(v_packet.snapshot#>>'{invoicePlan,autoSend}','false')='true' then
    insert into public.invoice_jobs(packet_id,record_id,owner_user_id,plan,idempotency_prefix)
    values(v_packet.id,v_record.id,v_record.owner_user_id,v_packet.snapshot->'invoicePlan','greenlit:'||v_packet.public_id||':'||coalesce(v_packet.snapshot#>>'{invoicePlan,planSha256}','plan'))
    on conflict(packet_id) do update set plan=excluded.plan
    returning id into v_invoice_job_id;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_QUEUED','SYSTEM',null,
      jsonb_build_object('packetId',v_packet.public_id,'jobId',v_invoice_job_id,'planSha256',v_packet.snapshot#>>'{invoicePlan,planSha256}','automatic',true));
  end if;
  if v_record.owner_user_id is not null then
    insert into public.operator_notifications(owner_user_id,record_id,event_type,title,body,payload,delivery_status)
    values(v_record.owner_user_id,v_record.id,p_decision,
      case when p_decision='APPROVED' then v_record.milestone_title||' was approved' else v_record.client_name||' requested changes' end,
      p_reviewer_name||case when p_decision='APPROVED' then ' recorded approval. Open the agency dashboard for the retained record.' else ' requested changes. Open the agency dashboard for the retained record.' end,
      jsonb_build_object('packetId',v_packet.public_id,'reviewerEmail',p_reviewer_email,'decidedAt',p_decided_at,'invoiceJobId',v_invoice_job_id),p_delivery_status)
    returning id into v_notification_id;
  end if;
  insert into public.receipt_sessions_v2(packet_id,session_hash,expires_at) values(v_packet.id,p_receipt_session_hash,p_receipt_session_expires_at);
  return jsonb_build_object('recordId',v_record.id,'notificationId',v_notification_id,'receiptSha256',v_event.event_hash,'auditSequence',v_event.sequence,'invoiceJobId',v_invoice_job_id);
end;
$$;

revoke all on function public.queue_verification_job_idempotent_atomic(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text,text,text,text,jsonb,text,jsonb,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.owner_beta_active(uuid) from public,anon,authenticated;
revoke all on function public.mint_receipt_session_atomic(uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.queue_verification_job_idempotent_atomic(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text,text,text,text,jsonb,text,jsonb,text,text,jsonb,text) to service_role;
grant execute on function public.owner_beta_active(uuid) to service_role;
grant execute on function public.mint_receipt_session_atomic(uuid,uuid,text,timestamptz,text) to service_role;

insert into public.app_schema_versions(version,description)
values('202607220001','Idempotent runs, safe billing, privacy export isolation, legal-hold safety, offboarding, and receipt recovery')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
