-- Stripe sandbox invoicing for the closed Greenlit agency beta.
-- Stripe calls happen in the web service; this migration owns durable state,
-- duplicate prevention, atomic approval-to-job handoff, and audit events.

create table if not exists public.stripe_connections (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null default false,
  status text not null default 'CONNECTED' check (status in ('CONNECTED','REAUTH_REQUIRED','DISCONNECTED')),
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  access_token_expires_at timestamptz,
  token_version integer not null default 1 check (token_version > 0),
  connected_at timestamptz not null default clock_timestamp(),
  disconnected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default clock_timestamp(),
  check (status <> 'CONNECTED' or (access_token_ciphertext is not null and refresh_token_ciphertext is not null and access_token_expires_at is not null))
);
alter table public.stripe_connections enable row level security;
revoke all on table public.stripe_connections from public,anon,authenticated;

create table if not exists public.stripe_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.stripe_oauth_states enable row level security;
revoke all on table public.stripe_oauth_states from public,anon,authenticated;
create index if not exists stripe_oauth_states_expiry_idx on public.stripe_oauth_states(expires_at);

create table if not exists public.record_invoice_plans (
  record_id uuid primary key references public.transaction_records(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  billing_name text not null check (char_length(billing_name) between 2 and 160),
  billing_email text not null check (char_length(billing_email) between 3 and 320),
  days_until_due integer not null check (days_until_due between 1 and 365),
  memo text not null default '' check (char_length(memo) <= 500),
  auto_send boolean not null default false,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  criteria_revision integer not null check (criteria_revision > 0),
  plan_sha256 text not null check (plan_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.record_invoice_plans enable row level security;
revoke all on table public.record_invoice_plans from public,anon,authenticated;
create index if not exists record_invoice_plans_owner_idx on public.record_invoice_plans(owner_user_id,updated_at desc);

create table if not exists public.invoice_jobs (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null unique references public.review_packets_v2(id) on delete cascade,
  record_id uuid not null references public.transaction_records(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','FAILED','COMPLETED')),
  attempts integer not null default 0 check (attempts >= 0),
  idempotency_prefix text not null unique,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.invoice_jobs enable row level security;
revoke all on table public.invoice_jobs from public,anon,authenticated;
create index if not exists invoice_jobs_status_idx on public.invoice_jobs(status,created_at);
create index if not exists invoice_jobs_owner_idx on public.invoice_jobs(owner_user_id,created_at desc);

create table if not exists public.record_invoices (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null unique references public.review_packets_v2(id) on delete cascade,
  record_id uuid not null references public.transaction_records(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  stripe_account_id text not null,
  stripe_customer_id text not null,
  stripe_invoice_id text not null,
  invoice_number text,
  status text not null check (status in ('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE')),
  amount_due_minor bigint not null check (amount_due_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  billing_email text not null,
  due_at timestamptz,
  hosted_invoice_url text,
  invoice_pdf_url text,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(stripe_account_id,stripe_invoice_id)
);
alter table public.record_invoices enable row level security;
revoke all on table public.record_invoices from public,anon,authenticated;
create index if not exists record_invoices_owner_idx on public.record_invoices(owner_user_id,created_at desc);
create index if not exists record_invoices_record_idx on public.record_invoices(record_id,created_at desc);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  stripe_account_id text,
  event_type text not null,
  object_id text,
  livemode boolean not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'PROCESSED' check (status in ('PROCESSED','IGNORED','FAILED')),
  error text,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz
);
alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from public,anon,authenticated;
create index if not exists stripe_webhook_events_received_idx on public.stripe_webhook_events(received_at desc);

create trigger stripe_connections_touch_updated_at before update on public.stripe_connections
for each row execute function public.touch_updated_at();
create trigger record_invoice_plans_touch_updated_at before update on public.record_invoice_plans
for each row execute function public.touch_updated_at();
create trigger invoice_jobs_touch_updated_at before update on public.invoice_jobs
for each row execute function public.touch_updated_at();
create trigger record_invoices_touch_updated_at before update on public.record_invoices
for each row execute function public.touch_updated_at();

create or replace function public.consume_stripe_oauth_state_atomic(p_state_hash text,p_owner_user_id uuid,p_now timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.stripe_oauth_states set used_at=p_now
  where state_hash=p_state_hash and owner_user_id=p_owner_user_id and used_at is null and expires_at>p_now;
  return found;
end; $$;

create or replace function public.queue_approved_invoice_job_atomic(p_packet_id uuid,p_owner_user_id uuid,p_actor_hash text)
returns public.invoice_jobs language plpgsql security definer set search_path=public as $$
declare v_packet public.review_packets_v2; v_record public.transaction_records; v_plan_row public.record_invoice_plans; v_plan jsonb; v_job public.invoice_jobs;
begin
  select * into v_packet from public.review_packets_v2 where id=p_packet_id for update;
  if v_packet.id is null or v_packet.decision<>'APPROVED' then raise exception 'An approved review packet is required'; end if;
  select * into v_record from public.transaction_records where id=v_packet.record_id for update;
  if v_record.owner_user_id is distinct from p_owner_user_id then raise exception 'Invoice owner mismatch'; end if;
  if coalesce(v_packet.snapshot#>>'{invoicePlan,enabled}','false')='true' then
    v_plan:=v_packet.snapshot->'invoicePlan';
  else
    select * into v_plan_row from public.record_invoice_plans where record_id=v_record.id and owner_user_id=p_owner_user_id;
    if v_plan_row.record_id is null then raise exception 'Configure invoice details before sending'; end if;
    if v_plan_row.amount_minor<>v_record.amount_minor or v_plan_row.currency<>v_record.currency or v_plan_row.criteria_revision<>v_record.criteria_revision then
      raise exception 'Invoice details are stale; review and save them again';
    end if;
    v_plan:=jsonb_build_object('enabled',true,'billingName',v_plan_row.billing_name,'billingEmail',v_plan_row.billing_email,
      'daysUntilDue',v_plan_row.days_until_due,'memo',v_plan_row.memo,'autoSend',false,'stripeCustomerId',v_plan_row.stripe_customer_id,
      'amountMinor',v_plan_row.amount_minor,'currency',v_plan_row.currency,'criteriaRevision',v_plan_row.criteria_revision,'planSha256',v_plan_row.plan_sha256);
  end if;
  select * into v_job from public.invoice_jobs where packet_id=v_packet.id for update;
  if v_job.id is null then
    insert into public.invoice_jobs(packet_id,record_id,owner_user_id,plan,idempotency_prefix)
    values(v_packet.id,v_record.id,v_record.owner_user_id,v_plan,'greenlit:'||v_packet.public_id||':'||coalesce(v_plan->>'planSha256','plan')) returning * into v_job;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_QUEUED','OWNER',p_actor_hash,
      jsonb_build_object('packetId',v_packet.public_id,'planSha256',v_plan->>'planSha256','automatic',false));
  elsif v_job.status='FAILED' then
    update public.invoice_jobs set status='PENDING',last_error=null,claimed_at=null where id=v_job.id returning * into v_job;
    perform public.append_transaction_event(v_record.id,'INVOICE_SEND_RETRIED','OWNER',p_actor_hash,
      jsonb_build_object('packetId',v_packet.public_id,'jobId',v_job.id));
  end if;
  return v_job;
end; $$;

create or replace function public.claim_invoice_job_atomic(p_job_id uuid,p_owner_user_id uuid,p_now timestamptz)
returns public.invoice_jobs language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs;
begin
  update public.invoice_jobs set status='PROCESSING',attempts=attempts+1,claimed_at=p_now,last_error=null
  where id=p_job_id and owner_user_id=p_owner_user_id
    and (status in ('PENDING','FAILED') or (status='PROCESSING' and claimed_at<p_now-interval '10 minutes'))
  returning * into v_job;
  return v_job;
end; $$;

create or replace function public.record_invoice_created_atomic(
  p_job_id uuid,p_stripe_account_id text,p_stripe_customer_id text,p_stripe_invoice_id text,
  p_amount_due_minor bigint,p_currency text,p_billing_email text,p_due_at timestamptz,
  p_invoice_number text,p_hosted_invoice_url text,p_invoice_pdf_url text
) returns public.record_invoices language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs; v_invoice public.record_invoices; v_was_new boolean;
begin
  select * into v_job from public.invoice_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'PROCESSING' then raise exception 'Invoice job is not processing'; end if;
  select not exists(select 1 from public.record_invoices where packet_id=v_job.packet_id) into v_was_new;
  insert into public.record_invoices(packet_id,record_id,owner_user_id,stripe_account_id,stripe_customer_id,stripe_invoice_id,invoice_number,status,amount_due_minor,currency,billing_email,due_at,hosted_invoice_url,invoice_pdf_url)
  values(v_job.packet_id,v_job.record_id,v_job.owner_user_id,p_stripe_account_id,p_stripe_customer_id,p_stripe_invoice_id,nullif(p_invoice_number,''),'DRAFT',p_amount_due_minor,upper(p_currency),lower(p_billing_email),p_due_at,nullif(p_hosted_invoice_url,''),nullif(p_invoice_pdf_url,''))
  on conflict(packet_id) do update set stripe_account_id=excluded.stripe_account_id,stripe_customer_id=excluded.stripe_customer_id,
    stripe_invoice_id=excluded.stripe_invoice_id,invoice_number=coalesce(excluded.invoice_number,public.record_invoices.invoice_number),
    amount_due_minor=excluded.amount_due_minor,currency=excluded.currency,billing_email=excluded.billing_email,due_at=coalesce(excluded.due_at,public.record_invoices.due_at),
    hosted_invoice_url=coalesce(excluded.hosted_invoice_url,public.record_invoices.hosted_invoice_url),invoice_pdf_url=coalesce(excluded.invoice_pdf_url,public.record_invoices.invoice_pdf_url),last_error=null
  returning * into v_invoice;
  if v_was_new then perform public.append_transaction_event(v_job.record_id,'INVOICE_CREATED','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'stripeInvoiceId',p_stripe_invoice_id,'amountMinor',p_amount_due_minor,'currency',upper(p_currency),'billingEmail',lower(p_billing_email))); end if;
  return v_invoice;
end; $$;

create or replace function public.record_invoice_sent_atomic(
  p_job_id uuid,p_invoice_number text,p_amount_due_minor bigint,p_amount_paid_minor bigint,p_currency text,
  p_due_at timestamptz,p_hosted_invoice_url text,p_invoice_pdf_url text,p_sent_at timestamptz
) returns public.record_invoices language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs; v_invoice public.record_invoices;
begin
  select * into v_job from public.invoice_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'PROCESSING' then raise exception 'Invoice job is not processing'; end if;
  update public.record_invoices set status='OPEN',invoice_number=nullif(p_invoice_number,''),amount_due_minor=p_amount_due_minor,
    amount_paid_minor=p_amount_paid_minor,currency=upper(p_currency),due_at=p_due_at,hosted_invoice_url=nullif(p_hosted_invoice_url,''),
    invoice_pdf_url=nullif(p_invoice_pdf_url,''),sent_at=coalesce(sent_at,p_sent_at),last_error=null where packet_id=v_job.packet_id returning * into v_invoice;
  if v_invoice.id is null then raise exception 'Draft invoice record is missing'; end if;
  update public.invoice_jobs set status='COMPLETED',completed_at=p_sent_at,last_error=null where id=v_job.id;
  perform public.append_transaction_event(v_job.record_id,'INVOICE_SENT','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'stripeInvoiceId',v_invoice.stripe_invoice_id,'invoiceNumber',v_invoice.invoice_number,'amountMinor',v_invoice.amount_due_minor,'currency',v_invoice.currency,'dueAt',v_invoice.due_at));
  return v_invoice;
end; $$;

create or replace function public.fail_invoice_job_atomic(p_job_id uuid,p_error text,p_failed_at timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs;
begin
  update public.invoice_jobs set status='FAILED',last_error=left(p_error,1000),claimed_at=null where id=p_job_id and status='PROCESSING' returning * into v_job;
  if v_job.id is null then return false; end if;
  update public.record_invoices set last_error=left(p_error,1000) where packet_id=v_job.packet_id;
  perform public.append_transaction_event(v_job.record_id,'INVOICE_SEND_FAILED','SYSTEM',null,jsonb_build_object('jobId',v_job.id,'error',left(p_error,500),'failedAt',p_failed_at));
  return true;
end; $$;

create or replace function public.apply_stripe_invoice_event_atomic(
  p_event_id text,p_stripe_account_id text,p_event_type text,p_stripe_invoice_id text,p_livemode boolean,p_payload_sha256 text,
  p_invoice_status text,p_invoice_number text,p_amount_due_minor bigint,p_amount_paid_minor bigint,p_currency text,
  p_due_at timestamptz,p_hosted_invoice_url text,p_invoice_pdf_url text,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_invoice public.record_invoices; v_previous_status text; v_audit_type text;
begin
  insert into public.stripe_webhook_events(event_id,stripe_account_id,event_type,object_id,livemode,payload_sha256,status,processed_at)
  values(p_event_id,p_stripe_account_id,p_event_type,p_stripe_invoice_id,p_livemode,p_payload_sha256,'PROCESSED',clock_timestamp())
  on conflict(event_id) do nothing;
  if not found then return false; end if;
  select * into v_invoice from public.record_invoices where stripe_account_id=p_stripe_account_id and stripe_invoice_id=p_stripe_invoice_id for update;
  if v_invoice.id is null then
    update public.stripe_webhook_events set status='IGNORED' where event_id=p_event_id;
    return true;
  end if;
  v_previous_status:=v_invoice.status;
  if p_invoice_status not in ('draft','open','paid','void','uncollectible') then raise exception 'Unsupported Stripe invoice status'; end if;
  update public.record_invoices set status=upper(p_invoice_status),invoice_number=coalesce(nullif(p_invoice_number,''),invoice_number),
    amount_due_minor=greatest(0,p_amount_due_minor),amount_paid_minor=greatest(0,p_amount_paid_minor),currency=upper(p_currency),due_at=coalesce(p_due_at,due_at),
    hosted_invoice_url=coalesce(nullif(p_hosted_invoice_url,''),hosted_invoice_url),invoice_pdf_url=coalesce(nullif(p_invoice_pdf_url,''),invoice_pdf_url),
    paid_at=case when p_invoice_status='paid' then coalesce(paid_at,p_occurred_at) else paid_at end,
    voided_at=case when p_invoice_status='void' then coalesce(voided_at,p_occurred_at) else voided_at end,
    last_error=case when p_event_type='invoice.payment_failed' then 'Stripe reported a failed payment attempt.' else null end
  where id=v_invoice.id returning * into v_invoice;
  v_audit_type:=case p_event_type when 'invoice.paid' then 'INVOICE_PAID' when 'invoice.payment_failed' then 'INVOICE_PAYMENT_FAILED' when 'invoice.voided' then 'INVOICE_VOIDED' when 'invoice.marked_uncollectible' then 'INVOICE_UNCOLLECTIBLE' else null end;
  if v_audit_type is not null or v_previous_status is distinct from v_invoice.status then
    perform public.append_transaction_event(v_invoice.record_id,coalesce(v_audit_type,'INVOICE_STATUS_UPDATED'),'SYSTEM',null,
      jsonb_build_object('stripeEventId',p_event_id,'stripeInvoiceId',p_stripe_invoice_id,'status',v_invoice.status,'amountDueMinor',v_invoice.amount_due_minor,'amountPaidMinor',v_invoice.amount_paid_minor,'occurredAt',p_occurred_at));
  end if;
  return true;
end; $$;

-- Rebuild the decision transaction so approval and automatic invoice-job
-- creation commit together. Stripe itself is called only after this commits.
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
end; $$;

create or replace function public.privacy_subject_record_ids(p_email text)
returns table(record_id uuid) language sql security definer set search_path=public,auth as $$
  select r.id from public.transaction_records r join auth.users u on u.id=r.owner_user_id where lower(u.email)=lower(p_email)
  union select p.record_id from public.review_packets_v2 p where p.reviewer_email is not null and lower(p.reviewer_email)=lower(p_email)
  union select p.record_id from public.record_invoice_plans p where lower(p.billing_email)=lower(p_email)
  union select i.record_id from public.record_invoices i where lower(i.billing_email)=lower(p_email)
$$;

-- Account deletion immediately severs Greenlit's usable Stripe credentials;
-- retained invoices then follow the same hold/deletion rules as their record.
create or replace function public.schedule_privacy_deletion_atomic(p_request_id uuid,p_operator_email text,p_now timestamptz)
returns integer language plpgsql security definer set search_path=public as $$
declare v_request public.privacy_requests_v2; v_record_id uuid; v_owner_user_id uuid; v_count integer:=0; v_actor_hash text;
begin
  select * into v_request from public.privacy_requests_v2 where id=p_request_id for update;
  if v_request.id is null or v_request.identity_verified_at is null then raise exception 'Verify the requester before scheduling deletion'; end if;
  v_actor_hash:=encode(extensions.digest(convert_to(lower(p_operator_email),'UTF8'),'sha256'::text),'hex');
  select id into v_owner_user_id from auth.users where lower(email)=lower(v_request.email) limit 1;
  for v_record_id in select id from public.transaction_records where owner_user_id=v_owner_user_id loop
    update public.transaction_records set privacy_deletion_requested_at=p_now,privacy_request_id=p_request_id,retention_until=least(retention_until,p_now) where id=v_record_id;
    perform public.append_transaction_event(v_record_id,'PRIVACY_DELETION_SCHEDULED','SYSTEM',v_actor_hash,jsonb_build_object('privacyRequestId',v_request.public_id,'scheduledAt',p_now));
    v_count:=v_count+1;
  end loop;
  delete from public.beta_feedback where lower(email)=lower(v_request.email) or (v_owner_user_id is not null and owner_user_id=v_owner_user_id);
  if v_owner_user_id is not null then
    update public.stripe_connections set status='DISCONNECTED',access_token_ciphertext=null,refresh_token_ciphertext=null,access_token_expires_at=null,disconnected_at=p_now,last_error=null where owner_user_id=v_owner_user_id;
    delete from public.stripe_oauth_states where owner_user_id=v_owner_user_id;
    delete from public.operator_notifications where owner_user_id=v_owner_user_id;
    delete from public.analysis_consent_events where owner_user_id=v_owner_user_id;
    delete from public.product_events where owner_user_id=v_owner_user_id;
    update public.beta_invites set status='REMOVED',removed_at=p_now,notes='Account deletion requested through '||v_request.public_id where lower(email)=lower(v_request.email);
    if not exists(select 1 from public.privacy_account_deletions where auth_user_id=v_owner_user_id and status in ('PENDING','FAILED')) then
      insert into public.privacy_account_deletions(request_id,auth_user_id,email,requested_at) values(p_request_id,v_owner_user_id,lower(v_request.email),p_now);
    end if;
  end if;
  update public.privacy_requests_v2 set status='PROCESSING',updated_at=p_now where id=p_request_id;
  perform public.record_operator_action(p_operator_email,'SCHEDULE_PRIVACY_DELETION','privacy_request',p_request_id::text,jsonb_build_object('ownedRecordCount',v_count,'accountCleanupQueued',v_owner_user_id is not null,'stripeCredentialsCleared',v_owner_user_id is not null,'reviewerRecordsRetainedForOperatorDecision',(select count(*) from public.privacy_subject_record_ids(v_request.email) s where s.record_id not in(select id from public.transaction_records where owner_user_id=v_owner_user_id))));
  return v_count;
end; $$;

revoke all on function public.consume_stripe_oauth_state_atomic(text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.queue_approved_invoice_job_atomic(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.claim_invoice_job_atomic(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.record_invoice_created_atomic(uuid,text,text,text,bigint,text,text,timestamptz,text,text,text) from public,anon,authenticated;
revoke all on function public.record_invoice_sent_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_invoice_job_atomic(uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.apply_stripe_invoice_event_atomic(text,text,text,text,boolean,text,text,text,bigint,bigint,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.privacy_subject_record_ids(text) from public,anon,authenticated;
revoke all on function public.schedule_privacy_deletion_atomic(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.consume_stripe_oauth_state_atomic(text,uuid,timestamptz) to service_role;
grant execute on function public.queue_approved_invoice_job_atomic(uuid,uuid,text) to service_role;
grant execute on function public.claim_invoice_job_atomic(uuid,uuid,timestamptz) to service_role;
grant execute on function public.record_invoice_created_atomic(uuid,text,text,text,bigint,text,text,timestamptz,text,text,text) to service_role;
grant execute on function public.record_invoice_sent_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) to service_role;
grant execute on function public.fail_invoice_job_atomic(uuid,text,timestamptz) to service_role;
grant execute on function public.apply_stripe_invoice_event_atomic(text,text,text,text,boolean,text,text,text,bigint,bigint,text,timestamptz,text,text,timestamptz) to service_role;
grant execute on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz) to service_role;
grant execute on function public.privacy_subject_record_ids(text) to service_role;
grant execute on function public.schedule_privacy_deletion_atomic(uuid,text,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607210005','Stripe sandbox invoicing, OAuth storage, invoice jobs, and webhook reconciliation')
on conflict(version) do update set description=excluded.description;
