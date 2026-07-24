import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { getOptionalUser } from "@/lib/supabase-server";
import { assertDecisionReceiptIntegrity, assertReviewSnapshotIntegrity, receiptSessionAuthorized, receiptSessionCookieName, reviewSessionAuthorized, reviewSessionCookieName } from "@/lib/review-session";
import { betaAccessAllowedFresh } from "@/lib/beta-access";

export async function GET(_request: Request, context: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await context.params;
  const session = (await cookies()).get(reviewSessionCookieName(packetId))?.value;
  const receiptSession = (await cookies()).get(receiptSessionCookieName(packetId))?.value;
  const user = await getOptionalUser();
  if (!session && !receiptSession && !user) return NextResponse.json({ error: "Open the secure review link or sign in as the milestone owner before exporting." }, { status: 401, headers: noStoreJsonHeaders() });

  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2")
      .select("id, record_id, public_id, snapshot, snapshot_sha256, expires_at, revoked_at, decision, reviewer_name, reviewer_email, reviewer_note, intent_confirmed, legal_terms_accepted, electronic_records_consent, notice_version, country_code, decided_at, receipt_sha256, decision_event_hash, created_at")
      .eq("public_id", packetId)
      .single();
    if (error || !packet) return NextResponse.json({ error: "The review record was not found." }, { status: 404, headers: noStoreJsonHeaders() });
    assertReviewSnapshotIntegrity(packet.snapshot, packet.snapshot_sha256);
    const reviewerAuthorized = await reviewSessionAuthorized(database, packet.id, session);
    const receiptAuthorized = packet.decision ? await receiptSessionAuthorized(database, packet.id, receiptSession) : false;
    const activeOwner = user && await betaAccessAllowedFresh(user) ? user : null;
    const { data: ownerRecord } = activeOwner ? await database.from("transaction_records").select("id").eq("id", packet.record_id).eq("owner_user_id", activeOwner.id).maybeSingle() : { data: null };
    if (!reviewerAuthorized && !receiptAuthorized && !ownerRecord) return NextResponse.json({ error: "The review session is invalid or this account does not own the record." }, { status: 401, headers: noStoreJsonHeaders() });
    if (!packet.decision) return NextResponse.json({ error: "A final decision has not been recorded yet." }, { status: 409, headers: noStoreJsonHeaders() });
    await assertDecisionReceiptIntegrity(database, packet);

    const { data: events, error: auditError } = await database.from("transaction_audit_events")
      .select("sequence, event_type, actor_type, payload, previous_hash, event_hash, occurred_at, retention_until")
      .eq("record_id", packet.record_id)
      .order("sequence", { ascending: true });
    if (auditError) throw new Error(auditError.message);
    const [{ data: invoice, error: invoiceError }, { data: invoiceJob, error: invoiceJobError }, { data: corrections, error: correctionError }] = await Promise.all([
      database.from("record_invoices").select("status,invoice_number,amount_due_minor,amount_paid_minor,currency,billing_email,due_at,hosted_invoice_url,invoice_pdf_url,sent_at,paid_at,voided_at,created_at,updated_at").eq("packet_id", packet.id).maybeSingle(),
      database.from("invoice_jobs").select("status,attempts,created_at,updated_at,completed_at").eq("packet_id", packet.id).maybeSingle(),
      database.from("privacy_record_amendments").select("field_name,previous_value,corrected_value,reason,created_at").eq("record_id", packet.record_id).order("created_at"),
    ]);
    const relatedError = invoiceError ?? invoiceJobError ?? correctionError;
    if (relatedError) throw new Error(relatedError.message);

    const exportedAt = new Date().toISOString();
    const ownerView = Boolean(ownerRecord);
    const body = {
      format: "Greenlit transaction export v1",
      exportedAt,
      packetId: packet.public_id,
      snapshot: packet.snapshot,
      snapshotSha256: packet.snapshot_sha256,
      decision: {
        value: packet.decision,
        reviewerName: packet.reviewer_name,
        reviewerEmail: packet.reviewer_email,
        reviewerNote: packet.reviewer_note,
        intentConfirmed: packet.intent_confirmed,
        legalTermsAccepted: packet.legal_terms_accepted,
        electronicRecordsConsent: packet.electronic_records_consent,
        noticeVersion: packet.notice_version,
        countryCode: packet.country_code,
        decidedAt: packet.decided_at,
        receiptSha256: packet.receipt_sha256,
      },
      invoicing: {
        provider: invoice || invoiceJob ? "Stripe" : null,
        invoice: invoice ? {
          status: invoice.status,
          invoiceNumber: invoice.invoice_number,
          amountDueMinor: invoice.amount_due_minor,
          amountPaidMinor: invoice.amount_paid_minor,
          currency: invoice.currency,
          billingEmail: invoice.billing_email,
          dueAt: invoice.due_at,
          hostedInvoiceUrl: invoice.hosted_invoice_url,
          invoicePdfUrl: invoice.invoice_pdf_url,
          sentAt: invoice.sent_at,
          paidAt: invoice.paid_at,
          voidedAt: invoice.voided_at,
          createdAt: invoice.created_at,
          updatedAt: invoice.updated_at,
        } : null,
        job: invoiceJob ? {
          status: invoiceJob.status,
          ...(ownerView ? { attempts: invoiceJob.attempts } : {}),
          createdAt: invoiceJob.created_at,
          updatedAt: invoiceJob.updated_at,
          completedAt: invoiceJob.completed_at,
        } : null,
      },
      corrections: corrections ?? [],
      retention: { packetCreatedAt: packet.created_at, reviewExpiresAt: packet.expires_at, policy: "See /records and /privacy" },
      auditChain: (events ?? []).map((event) => ({
        sequence: event.sequence,
        eventType: event.event_type,
        actorType: event.actor_type,
        ...(ownerView ? { payload: event.payload } : {}),
        previousHash: event.previous_hash,
        eventHash: event.event_hash,
        occurredAt: event.occurred_at,
        retentionUntil: event.retention_until,
      })),
    };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        ...noStoreJsonHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="greenlit-${packetId}.json"`,
      },
    });
  } catch (error) {
    console.error("Transaction export failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "The transaction export is temporarily unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
