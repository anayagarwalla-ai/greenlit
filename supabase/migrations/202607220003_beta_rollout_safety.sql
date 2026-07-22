-- Final closed-beta rollout safeguards: material milestone revisions, immediate
-- privacy offboarding, and invoice/deletion serialization.

alter table public.transaction_records
  add column if not exists scope_sha256 text;

create or replace function public.milestone_scope_sha256(
  p_mode text,p_agency_name text,p_client_name text,p_project_name text,p_milestone_title text,
  p_amount_minor bigint,p_currency text,p_source_name text,p_source_sha256 text,
  p_criteria_sha256 text,p_target_origin text,p_checks jsonb
) returns text language sql immutable set search_path=public,extensions as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'mode',p_mode,
    'agencyName',p_agency_name,
    'clientName',p_client_name,
    'projectName',p_project_name,
    'milestoneTitle',p_milestone_title,
    'amountMinor',p_amount_minor,
    'currency',upper(p_currency),
    'sourceName',p_source_name,
    'sourceSha256',p_source_sha256,
    'criteriaSha256',p_criteria_sha256,
    'targetOrigin',p_target_origin,
    'checks',coalesce(p_checks,'[]'::jsonb)
  )::text,'UTF8'),'sha256'::text),'hex')
$$;

update public.transaction_records r
set scope_sha256=public.milestone_scope_sha256(
  r.mode,r.agency_name,r.client_name,r.project_name,r.milestone_title,
  r.amount_minor,r.currency,r.source_name,r.source_sha256,r.criteria_sha256,r.target_origin,
  coalesce((select j.checks from public.verification_jobs_v2 j where j.record_id=r.id order by j.created_at desc,j.id desc limit 1),'[]'::jsonb)
)
where r.scope_sha256 is null;

alter table public.transaction_records
  alter column scope_sha256 set default repeat('0',64);
alter table public.transaction_records
  alter column scope_sha256 set not null;
alter table public.transaction_records
  drop constraint if exists transaction_records_scope_sha256_check;
alter table public.transaction_records
  add constraint transaction_records_scope_sha256_check check(scope_sha256 ~ '^[a-f0-9]{64}$');

create or replace function public.queue_verification_job_atomic(
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
  p_origin_addresses jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_record public.transaction_records;
  v_record_id uuid;
  v_job_id uuid:=gen_random_uuid();
  v_revision integer:=1;
  v_scope_sha256 text;
  v_checks_sha256 text;
  v_previous_scope jsonb;
  v_new_scope jsonb;
begin
  v_scope_sha256:=public.milestone_scope_sha256(
    p_mode,p_agency_name,p_client_name,p_project_name,p_milestone_title,p_amount_minor,
    p_currency,p_source_name,p_source_sha256,p_criteria_sha256,p_target_origin,p_checks
  );
  v_checks_sha256:=encode(extensions.digest(convert_to(coalesce(p_checks,'[]'::jsonb)::text,'UTF8'),'sha256'::text),'hex');
  v_new_scope:=jsonb_build_object(
    'mode',p_mode,'agencyName',p_agency_name,'clientName',p_client_name,'projectName',p_project_name,
    'milestoneTitle',p_milestone_title,'amountMinor',p_amount_minor,'currency',upper(p_currency),
    'sourceName',p_source_name,'sourceSha256',p_source_sha256,'criteriaSha256',p_criteria_sha256,
    'targetOrigin',p_target_origin,'checksSha256',v_checks_sha256,'scopeSha256',v_scope_sha256
  );

  if p_record_id is not null then
    select * into v_record from public.transaction_records where id=p_record_id for update;
    if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Record not found for this owner'; end if;
    if v_record.status not in ('READY','NEEDS_WORK','CHANGES_REQUESTED','READY_FOR_REVIEW') then raise exception 'Record cannot start a run from %',v_record.status; end if;
    if exists(select 1 from public.verification_jobs_v2 where record_id=v_record.id and status in ('QUEUED','LEASED','RUNNING')) then raise exception 'An active verification job already exists'; end if;
    v_record_id:=v_record.id;
    v_revision:=v_record.criteria_revision+case when v_record.scope_sha256 is distinct from v_scope_sha256 then 1 else 0 end;
    v_previous_scope:=jsonb_build_object(
      'mode',v_record.mode,'agencyName',v_record.agency_name,'clientName',v_record.client_name,
      'projectName',v_record.project_name,'milestoneTitle',v_record.milestone_title,
      'amountMinor',v_record.amount_minor,'currency',v_record.currency,'sourceName',v_record.source_name,
      'sourceSha256',v_record.source_sha256,'criteriaSha256',v_record.criteria_sha256,
      'targetOrigin',v_record.target_origin,'scopeSha256',v_record.scope_sha256
    );
    if v_revision<>v_record.criteria_revision then
      update public.review_packets_v2 set revoked_at=coalesce(revoked_at,clock_timestamp())
      where record_id=v_record_id and decision is null;
    end if;
    update public.transaction_records set
      mode=p_mode,agency_name=p_agency_name,client_name=p_client_name,project_name=p_project_name,
      milestone_title=p_milestone_title,amount_minor=p_amount_minor,currency=upper(p_currency),
      source_name=p_source_name,source_sha256=p_source_sha256,confirmed_criteria=p_criteria,
      criteria_sha256=p_criteria_sha256,criteria_revision=v_revision,target_origin=p_target_origin,
      workspace_state=p_workspace_state,status='VERIFYING',active_job_id=v_job_id,scope_sha256=v_scope_sha256
    where id=v_record_id;
    if v_revision<>v_record.criteria_revision then
      perform public.append_transaction_event(v_record_id,'MILESTONE_REVISED','OWNER',p_actor_hash,
        jsonb_build_object('criteriaRevision',v_revision,'previousScope',v_previous_scope,'newScope',v_new_scope,
          'criteriaCount',jsonb_array_length(p_criteria),'checkCount',jsonb_array_length(p_checks)));
    end if;
  else
    insert into public.transaction_records(
      public_id,owner_token_hash,owner_user_id,mode,agency_name,client_name,project_name,
      milestone_title,amount_minor,currency,source_name,source_sha256,confirmed_criteria,
      criteria_sha256,target_origin,criteria_revision,status,workspace_state,active_job_id,scope_sha256
    ) values (
      p_record_public_id,p_owner_token_hash,p_owner_user_id,p_mode,p_agency_name,p_client_name,
      p_project_name,p_milestone_title,p_amount_minor,upper(p_currency),p_source_name,p_source_sha256,
      p_criteria,p_criteria_sha256,p_target_origin,1,'VERIFYING',p_workspace_state,v_job_id,v_scope_sha256
    ) returning id into v_record_id;
    perform public.append_transaction_event(v_record_id,'MILESTONE_FROZEN','OWNER',p_actor_hash,
      jsonb_build_object('publicId',p_record_public_id,'criteriaRevision',1,'scope',v_new_scope,
        'criteriaCount',jsonb_array_length(p_criteria),'checkCount',jsonb_array_length(p_checks),
        'criteriaConfirmedByOwner',true,'ownerTermsAccepted',true,'noticeVersion',p_notice_version));
  end if;

  insert into public.verification_jobs_v2(
    id,record_id,status,target_origin,build_url,build_label,checks,runner_version,
    criteria_revision,criteria_sha256,origin_addresses
  ) values (
    v_job_id,v_record_id,'QUEUED',p_target_origin,p_build_url,p_build_label,p_checks,p_runner_version,
    v_revision,p_criteria_sha256,coalesce(p_origin_addresses,'[]'::jsonb)
  );
  perform public.append_transaction_event(v_record_id,'VERIFICATION_QUEUED','OWNER',p_actor_hash,
    jsonb_build_object('jobId',v_job_id,'buildLabel',p_build_label,'targetOrigin',p_target_origin,
      'checkCount',jsonb_array_length(p_checks),'checksSha256',v_checks_sha256,
      'criteriaRevision',v_revision,'scopeSha256',v_scope_sha256));
  return jsonb_build_object('recordId',v_record_id,'jobId',v_job_id,'criteriaRevision',v_revision,'scopeSha256',v_scope_sha256);
end;
$$;

create or replace function public.schedule_privacy_deletion_atomic(p_request_id uuid,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public,auth as $$
declare
  v_request public.privacy_requests_v2;
  v_record public.transaction_records;
  v_job public.verification_jobs_v2;
  v_owner_user_id uuid;
  v_count integer:=0;
  v_actor_hash text;
  v_reviewer_record_count integer:=0;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null or v_request.identity_verified_at is null then raise exception 'Verify the requester before scheduling deletion'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  select id into v_owner_user_id from auth.users where lower(email)=lower(v_request.email) limit 1;

  if v_owner_user_id is not null then
    -- Match all owner admission/removal paths: invite first, invoice jobs next.
    perform 1 from public.beta_invites where email=lower(v_request.email) for update;
    perform 1 from public.invoice_jobs where owner_user_id=v_owner_user_id order by id for update;
    if exists(select 1 from public.invoice_jobs where owner_user_id=v_owner_user_id and status='PROCESSING') then
      raise exception 'Resolve the processing invoice job before deleting this account';
    end if;

    update public.beta_invites set status='REMOVED',removed_at=p_now,
      notes='Account deletion requested through '||v_request.public_id
    where email=lower(v_request.email);
    update public.invoice_jobs set status='CANCELLED',claimed_at=null,failure_code=null,
      last_error='Cancelled because the account was scheduled for privacy deletion.'
    where owner_user_id=v_owner_user_id and status in ('PENDING','FAILED');
    update public.review_packets_v2 set revoked_at=coalesce(revoked_at,p_now)
    where decision is null and record_id in(select id from public.transaction_records where owner_user_id=v_owner_user_id);

    for v_record in select * from public.transaction_records where owner_user_id=v_owner_user_id order by id for update loop
      for v_job in select * from public.verification_jobs_v2
        where record_id=v_record.id and status in ('QUEUED','LEASED','RUNNING') order by id for update
      loop
        update public.verification_jobs_v2 set status='EXPIRED',
          last_error='Cancelled because the account was scheduled for privacy deletion.',completed_at=p_now
        where id=v_job.id;
        update public.transaction_records set status='READY',active_job_id=null
        where id=v_record.id and active_job_id=v_job.id;
        perform public.append_transaction_event(v_record.id,'VERIFICATION_CANCELLED','SYSTEM',v_actor_hash,
          jsonb_build_object('jobId',v_job.id,'reason','Privacy deletion scheduled','privacyRequestId',v_request.public_id));
      end loop;
      update public.transaction_records set privacy_deletion_requested_at=p_now,privacy_request_id=p_request_id,
        retention_until=least(retention_until,p_now) where id=v_record.id;
      perform public.append_transaction_event(v_record.id,'PRIVACY_DELETION_SCHEDULED','SYSTEM',v_actor_hash,
        jsonb_build_object('privacyRequestId',v_request.public_id,'scheduledAt',p_now));
      v_count:=v_count+1;
    end loop;

    update public.stripe_connections set status='DISCONNECTED',access_token_ciphertext=null,
      refresh_token_ciphertext=null,access_token_expires_at=null,refresh_claim_id=null,
      refresh_claimed_at=null,disconnected_at=p_now,last_error=null where owner_user_id=v_owner_user_id;
    delete from public.stripe_oauth_states where owner_user_id=v_owner_user_id;
    delete from public.operator_notifications where owner_user_id=v_owner_user_id;
    delete from public.analysis_consent_events where owner_user_id=v_owner_user_id;
    delete from public.product_events where owner_user_id=v_owner_user_id;
    if not exists(select 1 from public.privacy_account_deletions where auth_user_id=v_owner_user_id and status in ('PENDING','FAILED')) then
      insert into public.privacy_account_deletions(request_id,auth_user_id,email,requested_at)
      values(p_request_id,v_owner_user_id,lower(v_request.email),p_now);
    end if;
  end if;

  delete from public.beta_feedback where lower(email)=lower(v_request.email)
    or (v_owner_user_id is not null and owner_user_id=v_owner_user_id);
  select count(*) into v_reviewer_record_count from public.privacy_subject_record_ids(v_request.email) s
    where v_owner_user_id is null or s.record_id not in(select id from public.transaction_records where owner_user_id=v_owner_user_id);
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id;
  perform public.record_operator_action(p_operator_email,'SCHEDULE_PRIVACY_DELETION','privacy_request',p_request_id::text,
    jsonb_build_object('ownedRecordCount',v_count,'accountCleanupQueued',v_owner_user_id is not null,
      'accessRevoked',v_owner_user_id is not null,'stripeCredentialsCleared',v_owner_user_id is not null,
      'reviewerRecordsRetainedForOperatorDecision',v_reviewer_record_count));
  return v_count;
end;
$$;

create or replace function public.record_invoice_sent_atomic(
  p_job_id uuid,p_invoice_number text,p_amount_due_minor bigint,p_amount_paid_minor bigint,p_currency text,
  p_due_at timestamptz,p_hosted_invoice_url text,p_invoice_pdf_url text,p_sent_at timestamptz
) returns public.record_invoices language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs; v_invoice public.record_invoices; v_owner_user_id uuid;
begin
  select owner_user_id into v_owner_user_id from public.invoice_jobs where id=p_job_id;
  if v_owner_user_id is null or not public.owner_beta_active_locked(v_owner_user_id) then
    raise exception 'The invoice owner is no longer an active beta account';
  end if;
  select * into v_job from public.invoice_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'PROCESSING' then raise exception 'Invoice job is not processing'; end if;
  if v_job.owner_user_id is distinct from v_owner_user_id then raise exception 'Invoice owner changed'; end if;
  update public.record_invoices set
    status=case when status in ('PAID','VOID','UNCOLLECTIBLE') then status else 'OPEN' end,
    invoice_number=nullif(p_invoice_number,''),amount_due_minor=p_amount_due_minor,
    amount_paid_minor=greatest(amount_paid_minor,p_amount_paid_minor),currency=upper(p_currency),due_at=p_due_at,
    hosted_invoice_url=nullif(p_hosted_invoice_url,''),invoice_pdf_url=nullif(p_invoice_pdf_url,''),
    sent_at=coalesce(sent_at,p_sent_at),last_error=null
  where packet_id=v_job.packet_id returning * into v_invoice;
  if v_invoice.id is null then raise exception 'Draft invoice record is missing'; end if;
  update public.invoice_jobs set status='COMPLETED',completed_at=p_sent_at,last_error=null,failure_code=null where id=v_job.id;
  perform public.append_transaction_event(v_job.record_id,'INVOICE_SENT','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'stripeInvoiceId',v_invoice.stripe_invoice_id,
      'invoiceNumber',v_invoice.invoice_number,'status',v_invoice.status,'amountMinor',v_invoice.amount_due_minor,
      'currency',v_invoice.currency,'dueAt',v_invoice.due_at));
  return v_invoice;
end;
$$;

revoke all on function public.milestone_scope_sha256(text,text,text,text,text,bigint,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.queue_verification_job_atomic(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text,text,text,text,jsonb,text,jsonb,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.schedule_privacy_deletion_atomic(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.record_invoice_sent_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.milestone_scope_sha256(text,text,text,text,text,bigint,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.queue_verification_job_atomic(uuid,text,uuid,text,text,text,text,text,text,bigint,text,text,text,jsonb,text,text,text,text,jsonb,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.schedule_privacy_deletion_atomic(uuid,text,timestamptz) to service_role;
grant execute on function public.record_invoice_sent_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607220003','Material revision hashing, immediate privacy offboarding, and invoice/deletion serialization')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
