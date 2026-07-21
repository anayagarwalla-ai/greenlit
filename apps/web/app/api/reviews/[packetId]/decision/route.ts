import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { canonicalJson, noStoreJsonHeaders, RECORD_NOTICE_VERSION, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { deliverNotification, type NotificationPayload } from "@/lib/notifications";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { reviewSessionAuthorized, reviewSessionCookieName } from "@/lib/review-session";

const schema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  reviewerName: z.string().trim().min(2).max(160),
  reviewerEmail: z.string().email().max(320),
  reviewerNote: z.string().trim().max(2_000).default(""),
  intentConfirmed: z.literal(true),
  electronicRecordsConsent: z.literal(true),
  noticeVersion: z.literal(RECORD_NOTICE_VERSION),
});

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const quota = await consumeRateLimit(request, "review-decision-hour", 10, 3_600);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name, business email, intent, and electronic-record consent are required." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  const session = (await cookies()).get(reviewSessionCookieName(packetId))?.value;
  if (!session) return NextResponse.json({ error: "The secure review session has expired." }, { status: 401, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2").select("id, record_id, snapshot, snapshot_sha256, expires_at, revoked_at, decision").eq("public_id", packetId).single();
    if (error || !packet || !await reviewSessionAuthorized(database, packet.id, session)) return NextResponse.json({ error: "The secure review session is invalid." }, { status: 401, headers: noStoreJsonHeaders() });
    if (packet.decision) return NextResponse.json({ error: "A final decision has already been recorded for this packet." }, { status: 409, headers: noStoreJsonHeaders() });
    if (packet.revoked_at) return NextResponse.json({ error: "This review link was revoked. Ask the agency for a new link." }, { status: 410, headers: noStoreJsonHeaders() });
    if (new Date(packet.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This review packet has expired." }, { status: 410, headers: noStoreJsonHeaders() });

    const decidedAt = new Date().toISOString();
    const actorHash = requestActorHash(request);
    const decisionRecord = { packetId, snapshotSha256: packet.snapshot_sha256, decision: parsed.data.decision, reviewerName: parsed.data.reviewerName, reviewerEmail: parsed.data.reviewerEmail, reviewerNote: parsed.data.reviewerNote, intentConfirmed: true, electronicRecordsConsent: true, noticeVersion: parsed.data.noticeVersion, actorHash, decidedAt };
    const receiptSha256 = sha256(canonicalJson({ snapshot: packet.snapshot, decision: decisionRecord }));
    const { error: updateError } = await database.rpc("record_review_decision_atomic", { p_packet_id: packet.id, p_decision: parsed.data.decision, p_reviewer_name: parsed.data.reviewerName, p_reviewer_email: parsed.data.reviewerEmail, p_reviewer_note: parsed.data.reviewerNote, p_notice_version: parsed.data.noticeVersion, p_actor_hash: actorHash, p_country_code: request.headers.get("x-vercel-ip-country") ?? null, p_decided_at: decidedAt, p_receipt_sha256: receiptSha256 });
    if (updateError) return NextResponse.json({ error: /already|unavailable/i.test(updateError.message) ? "Another decision was recorded first, or this review is no longer available. Refresh the review." : updateError.message }, { status: 409, headers: noStoreJsonHeaders() });
    const { data: ownerRecord } = await database.from("transaction_records").select("owner_user_id, milestone_title, client_name").eq("id", packet.record_id).single();
    if (ownerRecord?.owner_user_id) {
      const { data: notification } = await database.from("operator_notifications").insert({
        owner_user_id: ownerRecord.owner_user_id,
        record_id: packet.record_id,
        event_type: parsed.data.decision,
        title: parsed.data.decision === "APPROVED" ? `${ownerRecord.milestone_title} was approved` : `${ownerRecord.client_name} requested changes`,
        body: `${parsed.data.reviewerName} recorded ${parsed.data.decision === "APPROVED" ? "approval" : "a change request"}. Open the agency dashboard for the retained record.`,
        payload: { packetId, reviewerEmail: parsed.data.reviewerEmail, decidedAt },
        delivery_status: process.env.NOTIFICATION_WEBHOOK_URL ? "PENDING_EMAIL" : "IN_APP",
      }).select("id, owner_user_id, record_id, event_type, title, body, payload, created_at").single();
      if (notification && process.env.NOTIFICATION_WEBHOOK_URL) await deliverNotification(notification as NotificationPayload);
    }
    return NextResponse.json({ decision: parsed.data.decision, decidedAt, receiptSha256, receiptUrl: `/receipt/${packetId}` }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The decision could not be recorded." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
