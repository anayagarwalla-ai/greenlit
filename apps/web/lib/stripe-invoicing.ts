import { requireSupabaseAdmin } from "./database";
import { assertFrozenInvoicePlan } from "./invoice-plan";
import { createStripeCustomer, createStripeInvoice, createStripeInvoiceItem, getStripeAccessForOwner, listStripeCustomers, retrieveStripeCustomer, retrieveStripeInvoice, sendStripeInvoice, type StripeInvoice } from "./stripe-api";
import { logOperationalEvent } from "./operations";
import { getOperationalControl } from "./operational-controls";

type InvoiceJob = { id: string; record_id: string; packet_id: string; owner_user_id: string; plan: unknown; idempotency_prefix: string; status: string };

function invoiceRpcPayload(jobId: string, invoice: StripeInvoice) {
  return {
    p_job_id: jobId,
    p_invoice_number: invoice.number ?? "",
    p_amount_due_minor: invoice.amount_due,
    p_amount_paid_minor: invoice.amount_paid,
    p_currency: invoice.currency.toUpperCase(),
    p_due_at: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
    p_hosted_invoice_url: invoice.hosted_invoice_url ?? "",
    p_invoice_pdf_url: invoice.invoice_pdf ?? "",
    p_sent_at: new Date().toISOString(),
  };
}

function testDraftRpcPayload(jobId: string, invoice: StripeInvoice) {
  return {
    p_job_id: jobId,
    p_invoice_number: invoice.number ?? "",
    p_amount_due_minor: invoice.amount_due,
    p_amount_paid_minor: invoice.amount_paid,
    p_currency: invoice.currency.toUpperCase(),
    p_due_at: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
    p_hosted_invoice_url: invoice.hosted_invoice_url ?? "",
    p_invoice_pdf_url: invoice.invoice_pdf ?? "",
    p_completed_at: new Date().toISOString(),
  };
}

export async function processInvoiceJob(jobId: string, ownerUserId: string) {
  // Retention recovery, approval callbacks, and operator retries all call the
  // executor directly. Check before the atomic claim so a pause leaves the
  // durable job pending and safe to resume.
  const control = await getOperationalControl("INVOICES");
  if (control.paused) return { status: "PAUSED" as const, control };

  const database = requireSupabaseAdmin();
  const { data: claimed, error: claimError } = await database.rpc("claim_invoice_job_atomic", { p_job_id: jobId, p_owner_user_id: ownerUserId, p_now: new Date().toISOString() });
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { status: "UNCHANGED" as const };
  const job = claimed as InvoiceJob;
  try {
    const plan = assertFrozenInvoicePlan(job.plan);
    const { data: record, error: recordError } = await database.from("transaction_records").select("public_id,agency_name,client_name,project_name,milestone_title,amount_minor,currency,criteria_revision,last_run_id").eq("id", job.record_id).single();
    if (recordError || !record) throw new Error("The invoice milestone record is unavailable.");
    if (plan.amountMinor !== record.amount_minor || plan.currency !== record.currency || plan.criteriaRevision !== record.criteria_revision) throw new Error("Invoice details no longer match the approved milestone.");
    const access = await getStripeAccessForOwner(job.owner_user_id);
    const [{ data: packet }, { data: run }] = await Promise.all([
      database.from("review_packets_v2").select("public_id,receipt_sha256,snapshot_sha256").eq("id", job.packet_id).single(),
      database.from("verification_jobs_v2").select("manifest_sha256").eq("id", record.last_run_id).single(),
    ]);
    if (!packet || !run?.manifest_sha256 || !packet.receipt_sha256) throw new Error("The approval receipt or evidence manifest is unavailable for invoice traceability.");
    const metadata = {
      greenlit_record_id: job.record_id,
      greenlit_record_public_id: record.public_id,
      greenlit_review_id: packet.public_id,
      greenlit_criteria_revision: String(record.criteria_revision),
      greenlit_receipt_sha256: packet.receipt_sha256,
      greenlit_evidence_manifest_sha256: run.manifest_sha256,
      greenlit_invoice_plan_sha256: plan.planSha256,
    };
    let customerId = plan.stripeCustomerId ?? null;
    if (customerId) {
      const customer = await retrieveStripeCustomer(access.accessToken, customerId);
      if (customer.email?.toLowerCase() !== plan.billingEmail.toLowerCase()) throw new Error("The selected Stripe customer no longer matches the billing email.");
    } else {
      const matches = await listStripeCustomers(access.accessToken, plan.billingEmail);
      if (matches.length > 1) throw new Error("Multiple Stripe customers use this email. Select the correct customer before retrying.");
      customerId = matches[0]?.id ?? (await createStripeCustomer(access.accessToken, { name: plan.billingName, email: plan.billingEmail, metadata }, `${job.idempotency_prefix}:customer`)).id;
    }

    const { data: existingInvoice } = await database.from("record_invoices").select("stripe_invoice_id").eq("packet_id", job.packet_id).maybeSingle();
    let invoice = existingInvoice?.stripe_invoice_id ? await retrieveStripeInvoice(access.accessToken, existingInvoice.stripe_invoice_id) : null;
    if (!invoice) {
      invoice = await createStripeInvoice(access.accessToken, { customer: customerId, daysUntilDue: plan.daysUntilDue, description: plan.memo || `${record.project_name} — ${record.milestone_title}`, metadata }, `${job.idempotency_prefix}:invoice`);
      await createStripeInvoiceItem(access.accessToken, { customer: customerId, invoice: invoice.id, amount: plan.amountMinor, currency: plan.currency, description: record.milestone_title, metadata }, `${job.idempotency_prefix}:item`);
      invoice = await retrieveStripeInvoice(access.accessToken, invoice.id);
      const { error: createdError } = await database.rpc("record_invoice_created_atomic", {
        p_job_id: job.id,
        p_stripe_account_id: access.accountId,
        p_stripe_customer_id: customerId,
        p_stripe_invoice_id: invoice.id,
        p_amount_due_minor: invoice.amount_due,
        p_currency: invoice.currency,
        p_billing_email: plan.billingEmail,
        p_due_at: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
        p_invoice_number: invoice.number ?? "",
        p_hosted_invoice_url: invoice.hosted_invoice_url ?? "",
        p_invoice_pdf_url: invoice.invoice_pdf ?? "",
      });
      if (createdError) throw new Error(createdError.message);
    }
    if (!access.livemode) {
      const { data, error: draftError } = await database.rpc("record_invoice_test_draft_atomic", testDraftRpcPayload(job.id, invoice));
      if (draftError) throw new Error(draftError.message);
      return { status: "COMPLETED" as const, invoice: data, delivery: "TEST_DRAFT" as const };
    }
    if (invoice.status === "draft") invoice = await sendStripeInvoice(access.accessToken, invoice.id, `${job.idempotency_prefix}:send`);
    if (invoice.status !== "open" && invoice.status !== "paid") throw new Error(`Stripe invoice is ${invoice.status ?? "unavailable"} and could not be sent.`);
    const { data, error: sentError } = await database.rpc("record_invoice_sent_atomic", invoiceRpcPayload(job.id, invoice));
    if (sentError) throw new Error(sentError.message);
    return { status: "COMPLETED" as const, invoice: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice delivery failed.";
    await database.rpc("fail_invoice_job_atomic", { p_job_id: job.id, p_error: message, p_failed_at: new Date().toISOString() });
    await logOperationalEvent({ severity: "ERROR", service: "stripe", eventType: "INVOICE_JOB_FAILED", recordId: job.record_id, details: { jobId: job.id, message } });
    throw new Error(message);
  }
}
