-- Close the remaining external-beta transaction-integrity gaps.
-- This migration binds runner callbacks to unique leases, requires every
-- automated criterion in the frozen record to have a check, makes invoice
-- plan/review redemption writes atomic with their audit events, and makes
-- Stripe connection and invoice status changes monotonic and recoverable.

alter table public.verification_jobs_v2
  add column if not exists lease_id uuid;
create unique index if not exists verification_jobs_v2_lease_id_idx
  on public.verification_jobs_v2(lease_id) where lease_id is not null;

create or replace function public.validate_verification_checks_manifest()
returns trigger language plpgsql set search_path=public as $$
declare
  v_count integer;
  v_automated_count integer;
  v_criteria jsonb;
begin
  if jsonb_typeof(new.checks)<>'array' then raise exception 'Checks must be an array'; end if;
  v_count:=jsonb_array_length(new.checks);
  if v_count<1 or v_count>6 then raise exception 'A retained run requires between 1 and 6 automated checks'; end if;
  if (select count(distinct item->>'id') from jsonb_array_elements(new.checks) item)<>v_count
     or (select count(distinct item->>'criterionId') from jsonb_array_elements(new.checks) item)<>v_count
     or exists(select 1 from jsonb_array_elements(new.checks) item where nullif(trim(item->>'id'),'') is null or nullif(trim(item->>'criterionId'),'') is null) then
    raise exception 'Check and criterion identifiers must be complete and unique';
  end if;

  select confirmed_criteria into v_criteria from public.transaction_records where id=new.record_id;
  if jsonb_typeof(v_criteria)<>'array' then raise exception 'The record has no frozen criteria manifest'; end if;
  select count(*) into v_automated_count
    from jsonb_array_elements(v_criteria) criterion
    where coalesce(criterion->>'supported','false')='true' and coalesce(criterion->>'checkType','manual')<>'manual';
  if v_automated_count<>v_count then raise exception 'Every frozen automated criterion must have exactly one check'; end if;
  if exists(
    select 1 from jsonb_array_elements(v_criteria) criterion
    where coalesce(criterion->>'supported','false')='true' and coalesce(criterion->>'checkType','manual')<>'manual'
      and not exists(
        select 1 from jsonb_array_elements(new.checks) check_item
        where check_item->>'criterionId'=criterion->>'id'
          and check_item->>'type'=criterion->>'checkType'
          and check_item->>'sourceQuote'=criterion->>'sourceQuote'
          and coalesce(check_item->>'confirmedByHuman','false')='true'
      )
  ) then raise exception 'A check is missing or does not match its frozen automated criterion'; end if;
  if exists(
    select 1 from jsonb_array_elements(new.checks) check_item
    where not exists(
      select 1 from jsonb_array_elements(v_criteria) criterion
      where criterion->>'id'=check_item->>'criterionId'
        and coalesce(criterion->>'supported','false')='true'
        and coalesce(criterion->>'checkType','manual')=check_item->>'type'
    )
  ) then raise exception 'A check points to a manual, missing, or incompatible criterion'; end if;
  return new;
end; $$;

drop function if exists public.lease_verification_job_atomic(uuid,integer);
create function public.lease_verification_job_atomic(p_job_id uuid,p_attempt integer,p_lease_id uuid)
returns public.verification_jobs_v2 language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2;
begin
  if p_lease_id is null then raise exception 'A unique lease claim is required'; end if;
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status<>'QUEUED' then raise exception 'Job cannot be leased from %',v_job.status; end if;
  update public.verification_jobs_v2 set status='RUNNING',attempt=p_attempt,lease_id=p_lease_id,
    started_at=coalesce(started_at,clock_timestamp()),leased_at=clock_timestamp(),last_error=null
    where id=p_job_id returning * into v_job;
  perform public.append_transaction_event(v_job.record_id,'VERIFICATION_STARTED','RUNNER',null,
    jsonb_build_object('jobId',p_job_id,'attempt',p_attempt,'leaseId',p_lease_id,'buildLabel',v_job.build_label));
  return v_job;
end; $$;

drop function if exists public.fail_verification_job_atomic(uuid,integer,text,text);
create function public.fail_verification_job_atomic(
  p_job_id uuid,p_attempt integer,p_lease_id uuid,p_error text,p_event_type text
) returns text language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status='FAILED' and v_job.attempt=p_attempt and v_job.lease_id=p_lease_id then return 'DUPLICATE'; end if;
  if v_job.status='COMPLETED' then return 'COMPLETED'; end if;
  if v_job.status not in ('LEASED','RUNNING') or v_job.attempt<>p_attempt or v_job.lease_id is distinct from p_lease_id then
    raise exception 'Stale or replayed verification lease cannot fail this job';
  end if;
  update public.verification_jobs_v2 set status='FAILED',last_error=left(p_error,300),completed_at=clock_timestamp() where id=p_job_id;
  update public.transaction_records set status='READY',active_job_id=null where id=v_job.record_id and active_job_id=p_job_id;
  perform public.append_transaction_event(v_job.record_id,p_event_type,'RUNNER',null,
    jsonb_build_object('jobId',p_job_id,'attempt',p_attempt,'leaseId',p_lease_id,'error',left(p_error,300)));
  return 'FAILED';
end; $$;

create or replace function public.fail_queued_verification_job_atomic(p_job_id uuid,p_error text,p_event_type text)
returns text language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status='FAILED' then return 'DUPLICATE'; end if;
  if v_job.status<>'QUEUED' or v_job.lease_id is not null then raise exception 'Only an unleased queued job can fail dispatch'; end if;
  update public.verification_jobs_v2 set status='FAILED',attempt=1,last_error=left(p_error,300),completed_at=clock_timestamp() where id=p_job_id;
  update public.transaction_records set status='READY',active_job_id=null where id=v_job.record_id and active_job_id=p_job_id;
  perform public.append_transaction_event(v_job.record_id,p_event_type,'SYSTEM',null,
    jsonb_build_object('jobId',p_job_id,'attempt',1,'error',left(p_error,300)));
  return 'FAILED';
end; $$;

drop function if exists public.complete_verification_job_atomic(uuid,integer,jsonb,jsonb,text,text,text,timestamptz,timestamptz);
create function public.complete_verification_job_atomic(
  p_job_id uuid,p_attempt integer,p_lease_id uuid,p_results jsonb,p_artifacts jsonb,
  p_browser_version text,p_runner_version text,p_manifest_sha256 text,
  p_started_at timestamptz,p_completed_at timestamptz
) returns text language plpgsql security definer set search_path=public as $$
declare v_job public.verification_jobs_v2; v_record public.transaction_records;
  v_check_count integer; v_result_count integer; v_artifact_count integer; v_outcome text;
begin
  select * into v_job from public.verification_jobs_v2 where id=p_job_id for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status='COMPLETED' and v_job.attempt=p_attempt and v_job.lease_id=p_lease_id then return 'DUPLICATE'; end if;
  if v_job.status not in ('LEASED','RUNNING') or v_job.attempt<>p_attempt or v_job.lease_id is distinct from p_lease_id then
    raise exception 'Stale or replayed verification lease cannot complete this job';
  end if;
  select * into v_record from public.transaction_records where id=v_job.record_id for update;
  if v_record.status<>'VERIFYING' or v_record.active_job_id is distinct from p_job_id
     or v_record.criteria_revision<>v_job.criteria_revision or v_record.criteria_sha256 is distinct from v_job.criteria_sha256 then
    raise exception 'Stale verification job cannot update this record';
  end if;
  v_check_count:=jsonb_array_length(coalesce(v_job.checks,'[]'::jsonb));
  v_result_count:=jsonb_array_length(coalesce(p_results,'[]'::jsonb));
  v_artifact_count:=jsonb_array_length(coalesce(p_artifacts,'[]'::jsonb));
  if v_check_count=0 or v_result_count<>v_check_count or v_artifact_count<>v_check_count then raise exception 'Frozen check, result, and artifact counts must match'; end if;
  if (select count(distinct value->>'criterionId') from jsonb_array_elements(p_results))<>v_check_count
     or (select count(distinct value->>'criterionId') from jsonb_array_elements(p_artifacts))<>v_check_count then raise exception 'Criterion IDs must be unique'; end if;
  if exists(select 1 from jsonb_array_elements(v_job.checks) c where not exists(select 1 from jsonb_array_elements(p_results) r where r->>'criterionId'=c->>'criterionId'))
     or exists(select 1 from jsonb_array_elements(v_job.checks) c where not exists(select 1 from jsonb_array_elements(p_artifacts) a where a->>'criterionId'=c->>'criterionId')) then raise exception 'Completion does not cover the frozen manifest'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_results) r
    join jsonb_array_elements(p_artifacts) a on a->>'criterionId'=r->>'criterionId'
    where coalesce(r->>'status','') not in ('PASS','FAIL','ERROR')
       or nullif(r->>'evidenceId','') is null or nullif(r->>'evidenceHash','') is null
       or r->>'evidenceId' is distinct from a->>'storagePath'
       or r->>'evidenceHash' is distinct from a->>'sha256'
  ) then raise exception 'Result evidence references do not match the submitted artifact manifest'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_artifacts) a
    where not exists(
      select 1 from public.evidence_artifacts_v2 stored
      where stored.run_id=p_job_id and stored.criterion_id=a->>'criterionId'
        and stored.kind=a->>'kind' and stored.storage_path=a->>'storagePath'
        and stored.sha256=a->>'sha256' and stored.byte_size=(a->>'byteSize')::bigint
    )
  ) then raise exception 'Completion artifacts do not match stored private evidence'; end if;
  v_outcome:=case when not exists(select 1 from jsonb_array_elements(p_results) r where r->>'status'<>'PASS') then 'READY_FOR_REVIEW' else 'NEEDS_WORK' end;
  update public.verification_jobs_v2 set status='COMPLETED',results=p_results,artifacts=p_artifacts,
    browser_version=p_browser_version,runner_version=p_runner_version,manifest_sha256=p_manifest_sha256,
    started_at=p_started_at,completed_at=p_completed_at,last_error=null where id=p_job_id;
  update public.transaction_records set status=v_outcome,last_run_id=p_job_id,active_job_id=null where id=v_job.record_id;
  perform public.append_transaction_event(v_job.record_id,'VERIFICATION_COMPLETED','RUNNER',null,
    jsonb_build_object('jobId',p_job_id,'attempt',p_attempt,'leaseId',p_lease_id,'outcome',v_outcome,'resultCount',v_result_count,
      'artifactCount',v_artifact_count,'manifestSha256',p_manifest_sha256,'criteriaRevision',v_job.criteria_revision,'completedAt',p_completed_at));
  return v_outcome;
end; $$;

create or replace function public.save_invoice_plan_atomic(
  p_record_id uuid,p_owner_user_id uuid,p_stripe_customer_id text,p_billing_name text,p_billing_email text,
  p_days_until_due integer,p_memo text,p_auto_send boolean,p_amount_minor bigint,p_currency text,
  p_criteria_revision integer,p_plan_sha256 text,p_actor_hash text
) returns public.record_invoice_plans language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records; v_plan public.record_invoice_plans;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Milestone not found'; end if;
  if v_record.status='IN_REVIEW' then raise exception 'Invoice details are frozen while client review is active'; end if;
  if v_record.status not in ('READY_FOR_REVIEW','APPROVED') then raise exception 'Finish verification before configuring an invoice'; end if;
  if v_record.status='APPROVED' and p_auto_send then raise exception 'Automatic sending must be configured before client review'; end if;
  if p_amount_minor<>v_record.amount_minor or upper(p_currency)<>v_record.currency or p_criteria_revision<>v_record.criteria_revision then raise exception 'Invoice details do not match the current milestone revision'; end if;
  insert into public.record_invoice_plans(record_id,owner_user_id,stripe_customer_id,billing_name,billing_email,days_until_due,memo,auto_send,amount_minor,currency,criteria_revision,plan_sha256)
  values(p_record_id,p_owner_user_id,p_stripe_customer_id,trim(p_billing_name),lower(trim(p_billing_email)),p_days_until_due,trim(p_memo),p_auto_send,p_amount_minor,upper(p_currency),p_criteria_revision,p_plan_sha256)
  on conflict(record_id) do update set stripe_customer_id=excluded.stripe_customer_id,billing_name=excluded.billing_name,billing_email=excluded.billing_email,
    days_until_due=excluded.days_until_due,memo=excluded.memo,auto_send=excluded.auto_send,amount_minor=excluded.amount_minor,currency=excluded.currency,
    criteria_revision=excluded.criteria_revision,plan_sha256=excluded.plan_sha256
  returning * into v_plan;
  perform public.append_transaction_event(p_record_id,'INVOICE_PLAN_SAVED','OWNER',p_actor_hash,
    jsonb_build_object('planSha256',p_plan_sha256,'autoSend',p_auto_send,'amountMinor',p_amount_minor,'currency',upper(p_currency)));
  return v_plan;
end; $$;

create or replace function public.remove_invoice_plan_atomic(p_record_id uuid,p_owner_user_id uuid,p_actor_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_record public.transaction_records; v_plan public.record_invoice_plans;
begin
  select * into v_record from public.transaction_records where id=p_record_id for update;
  if v_record.id is null or v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Milestone not found'; end if;
  if v_record.status='IN_REVIEW' then raise exception 'Invoice details are frozen while client review is active'; end if;
  delete from public.record_invoice_plans where record_id=p_record_id and owner_user_id=p_owner_user_id returning * into v_plan;
  if v_plan.record_id is null then return false; end if;
  perform public.append_transaction_event(p_record_id,'INVOICE_PLAN_REMOVED','OWNER',p_actor_hash,
    jsonb_build_object('planSha256',v_plan.plan_sha256));
  return true;
end; $$;

create or replace function public.redeem_review_packet_atomic(
  p_packet_id uuid,p_session_hash text,p_session_expires_at timestamptz,p_actor_hash text,
  p_snapshot_sha256 text,p_redeemed_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_session_id uuid;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null then raise exception 'Review packet not found'; end if;
  if v_packet.revoked_at is not null or v_packet.expires_at<=p_redeemed_at then raise exception 'Review packet unavailable'; end if;
  if v_packet.snapshot_sha256 is distinct from p_snapshot_sha256 then raise exception 'Review snapshot changed before redemption'; end if;
  insert into public.review_sessions_v2(packet_id,session_hash,expires_at) values(v_packet.id,p_session_hash,p_session_expires_at) returning id into v_session_id;
  perform public.append_transaction_event(v_packet.record_id,'REVIEW_LINK_REDEEMED','REVIEWER',p_actor_hash,
    jsonb_build_object('packetId',v_packet.public_id,'snapshotSha256',v_packet.snapshot_sha256,'redeemedAt',p_redeemed_at));
  return v_session_id;
end; $$;

alter table public.stripe_connections
  add column if not exists refresh_claim_id uuid,
  add column if not exists refresh_claimed_at timestamptz;

create table if not exists public.stripe_connection_events (
  id bigint generated always as identity primary key,
  owner_user_id uuid references auth.users(id) on delete set null,
  stripe_account_id text,
  event_type text not null check(event_type in ('CONNECTED','RECONNECTED','TOKEN_REFRESHED','REAUTH_REQUIRED','DISCONNECTED','DEAUTHORIZED')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  retention_until timestamptz not null default (now()+interval '4 years')
);
alter table public.stripe_connection_events enable row level security;
revoke all on table public.stripe_connection_events from public,anon,authenticated;
create index if not exists stripe_connection_events_owner_idx on public.stripe_connection_events(owner_user_id,occurred_at desc);

create or replace function public.connect_stripe_account_atomic(
  p_owner_user_id uuid,p_stripe_account_id text,p_livemode boolean,p_access_ciphertext text,
  p_refresh_ciphertext text,p_access_expires_at timestamptz,p_connected_at timestamptz
) returns public.stripe_connections language plpgsql security definer set search_path=public as $$
declare v_previous public.stripe_connections; v_connection public.stripe_connections;
begin
  select * into v_previous from public.stripe_connections where owner_user_id=p_owner_user_id for update;
  insert into public.stripe_connections(owner_user_id,stripe_account_id,livemode,status,access_token_ciphertext,refresh_token_ciphertext,access_token_expires_at,connected_at,disconnected_at,last_error,refresh_claim_id,refresh_claimed_at)
  values(p_owner_user_id,p_stripe_account_id,p_livemode,'CONNECTED',p_access_ciphertext,p_refresh_ciphertext,p_access_expires_at,p_connected_at,null,null,null,null)
  on conflict(owner_user_id) do update set stripe_account_id=excluded.stripe_account_id,livemode=excluded.livemode,status='CONNECTED',
    access_token_ciphertext=excluded.access_token_ciphertext,refresh_token_ciphertext=excluded.refresh_token_ciphertext,
    access_token_expires_at=excluded.access_token_expires_at,token_version=public.stripe_connections.token_version+1,
    connected_at=excluded.connected_at,disconnected_at=null,last_error=null,refresh_claim_id=null,refresh_claimed_at=null
  returning * into v_connection;
  insert into public.stripe_connection_events(owner_user_id,stripe_account_id,event_type,details,occurred_at)
  values(p_owner_user_id,p_stripe_account_id,case when v_previous.owner_user_id is null then 'CONNECTED' else 'RECONNECTED' end,
    jsonb_build_object('livemode',p_livemode,'tokenVersion',v_connection.token_version),p_connected_at);
  return v_connection;
end; $$;

create or replace function public.disconnect_stripe_account_atomic(
  p_owner_user_id uuid,p_disconnected_at timestamptz,p_reason text
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_connection public.stripe_connections;
begin
  update public.stripe_connections set status='DISCONNECTED',access_token_ciphertext=null,refresh_token_ciphertext=null,
    access_token_expires_at=null,refresh_claim_id=null,refresh_claimed_at=null,disconnected_at=p_disconnected_at,last_error=null
    where owner_user_id=p_owner_user_id returning * into v_connection;
  if v_connection.owner_user_id is null then return false; end if;
  insert into public.stripe_connection_events(owner_user_id,stripe_account_id,event_type,details,occurred_at)
  values(v_connection.owner_user_id,v_connection.stripe_account_id,'DISCONNECTED',jsonb_build_object('reason',left(coalesce(p_reason,'manual'),200)),p_disconnected_at);
  return true;
end; $$;

create or replace function public.record_stripe_deauthorization_atomic(
  p_event_id text,p_stripe_account_id text,p_livemode boolean,p_payload_sha256 text,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_connection public.stripe_connections;
begin
  insert into public.stripe_webhook_events(event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,status,processed_at)
  values(p_event_id,p_stripe_account_id,'account.application.deauthorized',p_stripe_account_id,p_livemode,p_payload_sha256,'PROCESSED',clock_timestamp())
  on conflict(event_id) do nothing;
  if not found then return false; end if;
  update public.stripe_connections set status='DISCONNECTED',access_token_ciphertext=null,refresh_token_ciphertext=null,
    access_token_expires_at=null,refresh_claim_id=null,refresh_claimed_at=null,disconnected_at=p_occurred_at,last_error=null
    where stripe_account_id=p_stripe_account_id returning * into v_connection;
  if v_connection.owner_user_id is null then
    update public.stripe_webhook_events set status='IGNORED' where event_id=p_event_id;
    return true;
  end if;
  insert into public.stripe_connection_events(owner_user_id,stripe_account_id,event_type,details,occurred_at)
  values(v_connection.owner_user_id,p_stripe_account_id,'DEAUTHORIZED',jsonb_build_object('stripeEventId',p_event_id),p_occurred_at);
  return true;
end; $$;

create or replace function public.claim_stripe_token_refresh_atomic(
  p_owner_user_id uuid,p_expected_version integer,p_claim_id uuid,p_claimed_at timestamptz
) returns public.stripe_connections language plpgsql security definer set search_path=public as $$
declare v_connection public.stripe_connections;
begin
  update public.stripe_connections set refresh_claim_id=p_claim_id,refresh_claimed_at=p_claimed_at
    where owner_user_id=p_owner_user_id and status='CONNECTED' and token_version=p_expected_version
      and (refresh_claim_id is null or refresh_claimed_at<p_claimed_at-interval '2 minutes')
    returning * into v_connection;
  return v_connection;
end; $$;

create or replace function public.complete_stripe_token_refresh_atomic(
  p_owner_user_id uuid,p_expected_version integer,p_claim_id uuid,p_stripe_account_id text,p_livemode boolean,
  p_access_ciphertext text,p_refresh_ciphertext text,p_access_expires_at timestamptz,p_completed_at timestamptz
) returns public.stripe_connections language plpgsql security definer set search_path=public as $$
declare v_connection public.stripe_connections;
begin
  update public.stripe_connections set stripe_account_id=p_stripe_account_id,livemode=p_livemode,
    access_token_ciphertext=p_access_ciphertext,refresh_token_ciphertext=p_refresh_ciphertext,access_token_expires_at=p_access_expires_at,
    token_version=token_version+1,last_error=null,refresh_claim_id=null,refresh_claimed_at=null
    where owner_user_id=p_owner_user_id and status='CONNECTED' and token_version=p_expected_version and refresh_claim_id=p_claim_id
    returning * into v_connection;
  if v_connection.owner_user_id is not null then
    insert into public.stripe_connection_events(owner_user_id,stripe_account_id,event_type,details,occurred_at)
    values(v_connection.owner_user_id,v_connection.stripe_account_id,'TOKEN_REFRESHED',jsonb_build_object('tokenVersion',v_connection.token_version),p_completed_at);
  end if;
  return v_connection;
end; $$;

create or replace function public.release_stripe_token_refresh_atomic(
  p_owner_user_id uuid,p_claim_id uuid,p_error text,p_require_reauth boolean,p_released_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_connection public.stripe_connections;
begin
  update public.stripe_connections set status=case when p_require_reauth then 'REAUTH_REQUIRED' else status end,
    last_error=left(p_error,1000),refresh_claim_id=null,refresh_claimed_at=null
    where owner_user_id=p_owner_user_id and refresh_claim_id=p_claim_id returning * into v_connection;
  if v_connection.owner_user_id is null then return false; end if;
  if p_require_reauth then
    insert into public.stripe_connection_events(owner_user_id,stripe_account_id,event_type,details,occurred_at)
    values(v_connection.owner_user_id,v_connection.stripe_account_id,'REAUTH_REQUIRED',jsonb_build_object('error',left(p_error,500)),p_released_at);
  end if;
  return true;
end; $$;

create or replace function public.record_invoice_test_draft_atomic(
  p_job_id uuid,p_invoice_number text,p_amount_due_minor bigint,p_amount_paid_minor bigint,p_currency text,
  p_due_at timestamptz,p_hosted_invoice_url text,p_invoice_pdf_url text,p_completed_at timestamptz
) returns public.record_invoices language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs; v_invoice public.record_invoices;
begin
  select * into v_job from public.invoice_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'PROCESSING' then raise exception 'Invoice job is not processing'; end if;
  update public.record_invoices set status='DRAFT',invoice_number=nullif(p_invoice_number,''),amount_due_minor=p_amount_due_minor,
    amount_paid_minor=greatest(amount_paid_minor,p_amount_paid_minor),currency=upper(p_currency),due_at=p_due_at,
    hosted_invoice_url=nullif(p_hosted_invoice_url,''),invoice_pdf_url=nullif(p_invoice_pdf_url,''),sent_at=null,last_error=null
  where packet_id=v_job.packet_id returning * into v_invoice;
  if v_invoice.id is null then raise exception 'Draft invoice record is missing'; end if;
  update public.invoice_jobs set status='COMPLETED',completed_at=p_completed_at,last_error=null where id=v_job.id;
  perform public.append_transaction_event(v_job.record_id,'INVOICE_TEST_DRAFT_CREATED','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'stripeInvoiceId',v_invoice.stripe_invoice_id,'amountMinor',v_invoice.amount_due_minor,
      'currency',v_invoice.currency,'testMode',true,'emailed',false,'completedAt',p_completed_at));
  return v_invoice;
end; $$;

alter table public.record_invoices
  add column if not exists last_stripe_event_at timestamptz,
  add column if not exists last_stripe_event_id text;

create or replace function public.apply_stripe_invoice_event_atomic(
  p_event_id text,p_stripe_account_id text,p_event_type text,p_stripe_invoice_id text,p_livemode boolean,p_payload_sha256 text,
  p_invoice_status text,p_invoice_number text,p_amount_due_minor bigint,p_amount_paid_minor bigint,p_currency text,
  p_due_at timestamptz,p_hosted_invoice_url text,p_invoice_pdf_url text,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_invoice public.record_invoices; v_previous_status text; v_next_status text; v_audit_type text;
begin
  insert into public.stripe_webhook_events(event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,status,processed_at)
  values(p_event_id,p_stripe_account_id,p_event_type,p_stripe_invoice_id,p_livemode,p_payload_sha256,'PROCESSED',clock_timestamp())
  on conflict(event_id) do nothing;
  if not found then return false; end if;
  select * into v_invoice from public.record_invoices where stripe_account_id=p_stripe_account_id and stripe_invoice_id=p_stripe_invoice_id for update;
  if v_invoice.id is null then update public.stripe_webhook_events set status='IGNORED' where event_id=p_event_id; return true; end if;
  if v_invoice.last_stripe_event_at is not null and p_occurred_at<v_invoice.last_stripe_event_at then
    update public.stripe_webhook_events set status='IGNORED' where event_id=p_event_id;
    return true;
  end if;
  v_previous_status:=v_invoice.status;
  v_next_status:=upper(p_invoice_status);
  if v_next_status not in ('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE') then raise exception 'Unsupported Stripe invoice status'; end if;
  v_next_status:=case
    when v_previous_status='PAID' then 'PAID'
    when v_previous_status='VOID' then 'VOID'
    when v_previous_status='UNCOLLECTIBLE' and v_next_status<>'PAID' then 'UNCOLLECTIBLE'
    when v_previous_status='OPEN' and v_next_status='DRAFT' then 'OPEN'
    else v_next_status end;
  update public.record_invoices set status=v_next_status,invoice_number=coalesce(nullif(p_invoice_number,''),invoice_number),
    amount_due_minor=greatest(0,p_amount_due_minor),amount_paid_minor=greatest(amount_paid_minor,greatest(0,p_amount_paid_minor)),
    currency=upper(p_currency),due_at=coalesce(p_due_at,due_at),hosted_invoice_url=coalesce(nullif(p_hosted_invoice_url,''),hosted_invoice_url),
    invoice_pdf_url=coalesce(nullif(p_invoice_pdf_url,''),invoice_pdf_url),
    sent_at=case when p_event_type='invoice.sent' then coalesce(sent_at,p_occurred_at) else sent_at end,
    paid_at=case when v_next_status='PAID' then coalesce(paid_at,p_occurred_at) else paid_at end,
    voided_at=case when v_next_status='VOID' then coalesce(voided_at,p_occurred_at) else voided_at end,
    last_error=case when p_event_type='invoice.payment_failed' and v_next_status='OPEN' then 'Stripe reported a failed payment attempt.' when v_next_status in ('PAID','VOID','UNCOLLECTIBLE') then null else last_error end,
    last_stripe_event_at=greatest(coalesce(last_stripe_event_at,'epoch'::timestamptz),p_occurred_at),last_stripe_event_id=p_event_id
    where id=v_invoice.id returning * into v_invoice;
  v_audit_type:=case p_event_type when 'invoice.paid' then 'INVOICE_PAID' when 'invoice.payment_failed' then 'INVOICE_PAYMENT_FAILED' when 'invoice.voided' then 'INVOICE_VOIDED' when 'invoice.marked_uncollectible' then 'INVOICE_UNCOLLECTIBLE' else null end;
  if v_audit_type is not null or v_previous_status is distinct from v_invoice.status then
    perform public.append_transaction_event(v_invoice.record_id,coalesce(v_audit_type,'INVOICE_STATUS_UPDATED'),'SYSTEM',null,
      jsonb_build_object('stripeEventId',p_event_id,'stripeInvoiceId',p_stripe_invoice_id,'previousStatus',v_previous_status,'status',v_invoice.status,
        'amountDueMinor',v_invoice.amount_due_minor,'amountPaidMinor',v_invoice.amount_paid_minor,'occurredAt',p_occurred_at));
  end if;
  return true;
end; $$;

revoke all on function public.lease_verification_job_atomic(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.fail_verification_job_atomic(uuid,integer,uuid,text,text) from public,anon,authenticated;
revoke all on function public.fail_queued_verification_job_atomic(uuid,text,text) from public,anon,authenticated;
revoke all on function public.complete_verification_job_atomic(uuid,integer,uuid,jsonb,jsonb,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.save_invoice_plan_atomic(uuid,uuid,text,text,text,integer,text,boolean,bigint,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.remove_invoice_plan_atomic(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.redeem_review_packet_atomic(uuid,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.connect_stripe_account_atomic(uuid,text,boolean,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.disconnect_stripe_account_atomic(uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function public.record_stripe_deauthorization_atomic(text,text,boolean,text,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_stripe_token_refresh_atomic(uuid,integer,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.complete_stripe_token_refresh_atomic(uuid,integer,uuid,text,boolean,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.release_stripe_token_refresh_atomic(uuid,uuid,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.record_invoice_test_draft_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;

grant execute on function public.lease_verification_job_atomic(uuid,integer,uuid) to service_role;
grant execute on function public.fail_verification_job_atomic(uuid,integer,uuid,text,text) to service_role;
grant execute on function public.fail_queued_verification_job_atomic(uuid,text,text) to service_role;
grant execute on function public.complete_verification_job_atomic(uuid,integer,uuid,jsonb,jsonb,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.save_invoice_plan_atomic(uuid,uuid,text,text,text,integer,text,boolean,bigint,text,integer,text,text) to service_role;
grant execute on function public.remove_invoice_plan_atomic(uuid,uuid,text) to service_role;
grant execute on function public.redeem_review_packet_atomic(uuid,text,timestamptz,text,text,timestamptz) to service_role;
grant execute on function public.connect_stripe_account_atomic(uuid,text,boolean,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.disconnect_stripe_account_atomic(uuid,timestamptz,text) to service_role;
grant execute on function public.record_stripe_deauthorization_atomic(text,text,boolean,text,timestamptz) to service_role;
grant execute on function public.claim_stripe_token_refresh_atomic(uuid,integer,uuid,timestamptz) to service_role;
grant execute on function public.complete_stripe_token_refresh_atomic(uuid,integer,uuid,text,boolean,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.release_stripe_token_refresh_atomic(uuid,uuid,text,boolean,timestamptz) to service_role;
grant execute on function public.record_invoice_test_draft_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607210007','Unique runner leases, complete criteria coverage, atomic review/invoice plans, monotonic Stripe state')
on conflict(version) do update set description=excluded.description;
