-- Preserve a terminal webhook status if it arrives between Stripe sending the
-- invoice and the web request recording send completion.
create or replace function public.record_invoice_sent_atomic(
  p_job_id uuid,p_invoice_number text,p_amount_due_minor bigint,p_amount_paid_minor bigint,p_currency text,
  p_due_at timestamptz,p_hosted_invoice_url text,p_invoice_pdf_url text,p_sent_at timestamptz
) returns public.record_invoices language plpgsql security definer set search_path=public as $$
declare v_job public.invoice_jobs; v_invoice public.record_invoices;
begin
  select * into v_job from public.invoice_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.status<>'PROCESSING' then raise exception 'Invoice job is not processing'; end if;
  update public.record_invoices set
    status=case when status in ('PAID','VOID','UNCOLLECTIBLE') then status else 'OPEN' end,
    invoice_number=nullif(p_invoice_number,''),amount_due_minor=p_amount_due_minor,
    amount_paid_minor=greatest(amount_paid_minor,p_amount_paid_minor),currency=upper(p_currency),due_at=p_due_at,
    hosted_invoice_url=nullif(p_hosted_invoice_url,''),invoice_pdf_url=nullif(p_invoice_pdf_url,''),
    sent_at=coalesce(sent_at,p_sent_at),last_error=null
  where packet_id=v_job.packet_id returning * into v_invoice;
  if v_invoice.id is null then raise exception 'Draft invoice record is missing'; end if;
  update public.invoice_jobs set status='COMPLETED',completed_at=p_sent_at,last_error=null where id=v_job.id;
  perform public.append_transaction_event(v_job.record_id,'INVOICE_SENT','SYSTEM',null,
    jsonb_build_object('jobId',v_job.id,'stripeInvoiceId',v_invoice.stripe_invoice_id,'invoiceNumber',v_invoice.invoice_number,'status',v_invoice.status,'amountMinor',v_invoice.amount_due_minor,'currency',v_invoice.currency,'dueAt',v_invoice.due_at));
  return v_invoice;
end; $$;

revoke all on function public.record_invoice_sent_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_invoice_sent_atomic(uuid,text,bigint,bigint,text,timestamptz,text,text,timestamptz) to service_role;

insert into public.app_schema_versions(version,description)
values('202607210006','Preserve terminal Stripe invoice state during send completion')
on conflict(version) do update set description=excluded.description;
