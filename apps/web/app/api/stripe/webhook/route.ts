import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { logOperationalEvent } from "@/lib/operations";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { getStripeAccessForOwner, retrieveStripeInvoice, verifyStripeWebhook } from "@/lib/stripe-api";

type StripeEvent = { id: string; type: string; account?: string; livemode: boolean; created: number; data?: { object?: Record<string, unknown> } };
const invoiceEvents = new Set(["invoice.created", "invoice.finalized", "invoice.sent", "invoice.updated", "invoice.paid", "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible"]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyStripeWebhook(rawBody, request.headers.get("stripe-signature"))) return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400, headers: noStoreJsonHeaders() });
  let event: StripeEvent;
  try { event = JSON.parse(rawBody) as StripeEvent; }
  catch { return NextResponse.json({ error: "Invalid Stripe event." }, { status: 400, headers: noStoreJsonHeaders() }); }
  if (!event.id || !event.type || typeof event.livemode !== "boolean") return NextResponse.json({ error: "Incomplete Stripe event." }, { status: 400, headers: noStoreJsonHeaders() });
  if (event.livemode && process.env.STRIPE_ALLOW_LIVE_MODE !== "true") return NextResponse.json({ error: "Live events are disabled." }, { status: 403, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  if (event.type === "account.application.deauthorized") {
    if (!event.account) return NextResponse.json({ error: "Deauthorization event is missing its Stripe account." }, { status: 400, headers: noStoreJsonHeaders() });
    const { error } = await database.rpc("record_stripe_deauthorization_atomic", { p_event_id: event.id, p_stripe_account_id: event.account, p_livemode: event.livemode, p_payload_sha256: sha256(rawBody), p_occurred_at: new Date(event.created * 1000).toISOString() });
    if (error) {
      await logOperationalEvent({ severity: "ERROR", service: "stripe", eventType: "STRIPE_DEAUTHORIZATION_FAILED", details: { eventId: event.id, accountId: event.account, message: error.message } });
      return NextResponse.json({ error: "Stripe deauthorization could not be recorded." }, { status: 503, headers: noStoreJsonHeaders() });
    }
    return NextResponse.json({ received: true }, { headers: noStoreJsonHeaders() });
  }
  if (!invoiceEvents.has(event.type)) return NextResponse.json({ received: true, ignored: true }, { headers: noStoreJsonHeaders() });
  const invoice = event.data?.object ?? {};
  const invoiceId = typeof invoice.id === "string" ? invoice.id : null;
  const status = typeof invoice.status === "string" ? invoice.status : null;
  if (!event.account || !invoiceId || !status) return NextResponse.json({ error: "Invoice event is missing its account, invoice, or status." }, { status: 400, headers: noStoreJsonHeaders() });
  try {
    const { data: connection, error: connectionError } = await database.from("stripe_connections").select("owner_user_id,livemode,status").eq("stripe_account_id", event.account).maybeSingle();
    if (connectionError) throw new Error(connectionError.message);
    if (!connection || connection.status !== "CONNECTED" || Boolean(connection.livemode) !== event.livemode) throw new Error("Stripe event does not match an active Greenlit connection.");
    const access = await getStripeAccessForOwner(connection.owner_user_id);
    const currentInvoice = await retrieveStripeInvoice(access.accessToken, invoiceId);
    if (!currentInvoice.status) throw new Error("Stripe returned an invoice without a current status.");
    const { error } = await database.rpc("apply_stripe_invoice_event_atomic", {
      p_event_id: event.id,
      p_stripe_account_id: event.account,
      p_event_type: event.type,
      p_stripe_invoice_id: invoiceId,
      p_livemode: event.livemode,
      p_payload_sha256: sha256(rawBody),
      p_invoice_status: currentInvoice.status,
      p_invoice_number: currentInvoice.number ?? "",
      p_amount_due_minor: currentInvoice.amount_due,
      p_amount_paid_minor: currentInvoice.amount_paid,
      p_currency: currentInvoice.currency,
      p_due_at: currentInvoice.due_date ? new Date(currentInvoice.due_date * 1000).toISOString() : null,
      p_hosted_invoice_url: currentInvoice.hosted_invoice_url ?? "",
      p_invoice_pdf_url: currentInvoice.invoice_pdf ?? "",
      p_occurred_at: new Date(event.created * 1000).toISOString(),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ received: true }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    await logOperationalEvent({ severity: "ERROR", service: "stripe", eventType: "STRIPE_WEBHOOK_FAILED", details: { eventId: event.id, eventType: event.type, message: error instanceof Error ? error.message : "Unknown webhook failure" } });
    return NextResponse.json({ error: "Stripe event processing failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
