-- Preserve the caller's provisional receipt digest as audit context. The final
-- receipt digest remains the append-only decision event hash returned by this
-- transaction.
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
      'provisionalReceiptSha256',p_receipt_sha256,'reviewerName',p_reviewer_name,'reviewerEmail',lower(trim(p_reviewer_email)),'reviewerNote',p_reviewer_note,'intentConfirmed',true,
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

revoke all on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_review_decision_with_notification_atomic(uuid,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607260008','Receipt provisional digest retained as review-decision audit context')
on conflict(version) do update set description=excluded.description,applied_at=clock_timestamp();
