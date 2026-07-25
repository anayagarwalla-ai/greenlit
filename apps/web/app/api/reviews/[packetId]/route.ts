import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { getOptionalUser } from "@/lib/supabase-server";
import { assertDecisionReceiptIntegrity, assertReviewSnapshotIntegrity, hydrateReviewEvidence, receiptSessionCookieName, receiptSessionDetails, reviewSessionAuthorized, reviewSessionCookieName } from "@/lib/review-session";
import { betaAccessAllowedFresh } from "@/lib/beta-access";

export async function GET(_request: Request, context: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await context.params;
  const session = (await cookies()).get(reviewSessionCookieName(packetId))?.value;
  const receiptSession = (await cookies()).get(receiptSessionCookieName(packetId))?.value;
  const user = await getOptionalUser();
  if (!session && !receiptSession && !user) return NextResponse.json({ error: "Open the secure review link or sign in as the milestone owner." }, { status: 401, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2").select("id, record_id, snapshot, snapshot_sha256, intended_reviewer_email, expires_at, revoked_at, decision, reviewer_name, reviewer_email, reviewer_note, decided_at, receipt_sha256, decision_event_hash").eq("public_id", packetId).single();
    if (error || !packet) return NextResponse.json({ error: "The review record was not found." }, { status: 404, headers: noStoreJsonHeaders() });
    assertReviewSnapshotIntegrity(packet.snapshot, packet.snapshot_sha256);
    const reviewerAuthorized = await reviewSessionAuthorized(database, packet.id, session);
    const receiptDetails = packet.decision ? await receiptSessionDetails(database, packet.id, receiptSession) : null;
    const receiptAuthorized = Boolean(receiptDetails);
    const activeOwner = user && await betaAccessAllowedFresh(user) ? user : null;
    const { data: ownerRecord } = activeOwner ? await database.from("transaction_records").select("id").eq("id", packet.record_id).eq("owner_user_id", activeOwner.id).maybeSingle() : { data: null };
    if (!reviewerAuthorized && !receiptAuthorized && !ownerRecord) return NextResponse.json({ error: "The review session is invalid or this account does not own the record." }, { status: 401, headers: noStoreJsonHeaders() });
    if (packet.revoked_at && !packet.decision) return NextResponse.json({ error: "This review packet was revoked." }, { status: 410, headers: noStoreJsonHeaders() });
    if (!ownerRecord && !receiptAuthorized && new Date(packet.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This review packet has expired." }, { status: 410, headers: noStoreJsonHeaders() });
    const decisionEvent = await assertDecisionReceiptIntegrity(database, packet);
    const [auditResult, invoiceResult, invoiceJobResult, correctionResult] = await Promise.all([
      database.from("transaction_audit_events").select("sequence, event_hash, occurred_at").eq("record_id", packet.record_id).order("sequence", { ascending: false }).limit(1).maybeSingle(),
      database.from("record_invoices").select("status,invoice_number,amount_due_minor,amount_paid_minor,currency,billing_email,due_at,hosted_invoice_url,invoice_pdf_url,sent_at,paid_at,last_error").eq("packet_id", packet.id).maybeSingle(),
      database.from("invoice_jobs").select("status,last_error,updated_at").eq("packet_id", packet.id).maybeSingle(),
      database.from("privacy_record_amendments").select("field_name,corrected_value,reason,created_at").eq("record_id", packet.record_id).order("created_at"),
    ]);
    const relatedError = auditResult.error ?? invoiceResult.error ?? invoiceJobResult.error ?? correctionResult.error;
    if (relatedError) throw new Error(relatedError.message);
    const auditHead = auditResult.data;
    const invoice = invoiceResult.data;
    const invoiceJob = invoiceJobResult.data;
    return NextResponse.json({ packetId, viewerRole: ownerRecord ? "OWNER" : "REVIEWER", snapshot: await hydrateReviewEvidence(database, packet.snapshot), snapshotSha256: packet.snapshot_sha256, intendedReviewerEmail: packet.intended_reviewer_email, expiresAt: packet.expires_at, receiptAccessExpiresAt: receiptDetails?.expiresAt ?? null, decision: packet.decision, reviewerName: packet.reviewer_name, reviewerEmail: packet.reviewer_email, reviewerNote: packet.reviewer_note, decidedAt: packet.decided_at, receiptSha256: packet.receipt_sha256, invoice, invoiceJob: invoiceJob ? { status: invoiceJob.status, lastError: ownerRecord ? invoiceJob.last_error : null, updatedAt: invoiceJob.updated_at } : null, corrections: correctionResult.data ?? [], decisionEvent, auditHead: auditHead ? { sequence: auditHead.sequence, eventHash: auditHead.event_hash, occurredAt: auditHead.occurred_at } : null }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Review record lookup failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "The review record is temporarily unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
