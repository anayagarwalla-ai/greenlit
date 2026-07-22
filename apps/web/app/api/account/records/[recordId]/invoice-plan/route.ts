import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { freezeInvoicePlan, invoicePlanInputSchema } from "@/lib/invoice-plan";
import { appendAuditEvent, noStoreJsonHeaders, requestActorHash } from "@/lib/recordkeeping";
import { getOptionalUser } from "@/lib/supabase-server";

async function contextFor(recordId: string) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return { error: "Sign in with an invited account to continue.", status: 401 as const };
  const database = requireSupabaseAdmin();
  const { data: record, error } = await database.from("transaction_records").select("id,owner_user_id,status,amount_minor,currency,criteria_revision").eq("id", recordId).maybeSingle();
  if (error || !record || record.owner_user_id !== user.id) return { error: "Milestone not found.", status: 404 as const };
  return { user, database, record };
}

export async function GET(_request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  const found = await contextFor(recordId);
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status ?? 401, headers: noStoreJsonHeaders() });
  const { data, error } = await found.database.from("record_invoice_plans").select("billing_name,billing_email,days_until_due,memo,auto_send,stripe_customer_id,amount_minor,currency,criteria_revision,plan_sha256,updated_at").eq("record_id", recordId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ plan: data ? { billingName: data.billing_name, billingEmail: data.billing_email, daysUntilDue: data.days_until_due, memo: data.memo, autoSend: data.auto_send, stripeCustomerId: data.stripe_customer_id, amountMinor: data.amount_minor, currency: data.currency, criteriaRevision: data.criteria_revision, planSha256: data.plan_sha256, updatedAt: data.updated_at } : null }, { headers: noStoreJsonHeaders() });
}

export async function POST(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  const found = await contextFor(recordId);
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status ?? 401, headers: noStoreJsonHeaders() });
  if (found.record.status === "IN_REVIEW") return NextResponse.json({ error: "Invoice details are frozen while the client review is active." }, { status: 409, headers: noStoreJsonHeaders() });
  if (!["READY_FOR_REVIEW", "APPROVED"].includes(found.record.status)) return NextResponse.json({ error: "Finish verification before configuring an invoice." }, { status: 409, headers: noStoreJsonHeaders() });
  const parsed = invoicePlanInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a billing name, valid email, and due date between 1 and 365 days." }, { status: 422, headers: noStoreJsonHeaders() });
  if (found.record.status === "APPROVED" && parsed.data.autoSend) return NextResponse.json({ error: "Automatic sending must be configured before client review. You can send this approved invoice manually." }, { status: 409, headers: noStoreJsonHeaders() });
  const plan = freezeInvoicePlan(parsed.data, found.record);
  const { error } = await found.database.from("record_invoice_plans").upsert({ record_id: recordId, owner_user_id: found.user.id, stripe_customer_id: plan.stripeCustomerId, billing_name: plan.billingName, billing_email: plan.billingEmail, days_until_due: plan.daysUntilDue, memo: plan.memo, auto_send: plan.autoSend, amount_minor: plan.amountMinor, currency: plan.currency, criteria_revision: plan.criteriaRevision, plan_sha256: plan.planSha256 }, { onConflict: "record_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  await appendAuditEvent({ recordId, eventType: "INVOICE_PLAN_SAVED", actorType: "OWNER", actorHash: requestActorHash(request), payload: { planSha256: plan.planSha256, autoSend: plan.autoSend, amountMinor: plan.amountMinor, currency: plan.currency } });
  return NextResponse.json({ plan }, { headers: noStoreJsonHeaders() });
}

export async function DELETE(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  const found = await contextFor(recordId);
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status ?? 401, headers: noStoreJsonHeaders() });
  if (found.record.status === "IN_REVIEW") return NextResponse.json({ error: "Invoice details are frozen while the client review is active." }, { status: 409, headers: noStoreJsonHeaders() });
  const { error } = await found.database.from("record_invoice_plans").delete().eq("record_id", recordId).eq("owner_user_id", found.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  await appendAuditEvent({ recordId, eventType: "INVOICE_PLAN_REMOVED", actorType: "OWNER", actorHash: requestActorHash(request) });
  return NextResponse.json({ removed: true }, { headers: noStoreJsonHeaders() });
}
