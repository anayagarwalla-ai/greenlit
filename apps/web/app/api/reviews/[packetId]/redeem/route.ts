import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { assertDecisionReceiptIntegrity, assertReviewSnapshotIntegrity, hydrateReviewEvidence, reviewSessionCookieName, reviewSessionExpiry } from "@/lib/review-session";
import { logProductEvent } from "@/lib/operations";

const schema = z.object({
  token: z.string().min(20).max(200),
  accessCode: z.string().trim().min(8).max(32),
  reviewerEmail: z.string().trim().email().max(320),
});

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const quota = await consumeRateLimit(request, "review-redeem-hour", 12, 3_600, null, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The review token is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2").select("id, record_id, snapshot, snapshot_sha256, expires_at, revoked_at, decision, reviewer_name, reviewer_email, reviewer_note, intended_reviewer_email, redeemed_at, decided_at, receipt_sha256, decision_event_hash").eq("public_id", packetId).single();
    if (error || !packet) return NextResponse.json({ error: "This review link is invalid." }, { status: 404, headers: noStoreJsonHeaders() });
    if (packet.revoked_at) return NextResponse.json({ error: "This review link was revoked. Ask the agency for a new link." }, { status: 410, headers: noStoreJsonHeaders() });
    if (new Date(packet.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This review link has expired. Ask the agency for a new authorized receipt link if access is still required." }, { status: 410, headers: noStoreJsonHeaders() });
    assertReviewSnapshotIntegrity(packet.snapshot, packet.snapshot_sha256);
    await assertDecisionReceiptIntegrity(database, packet);

    const session = randomToken();
    const sessionExpiry = reviewSessionExpiry(packet.expires_at);
    const redeemedAt = new Date().toISOString();
    const { error: updateError } = await database.rpc("redeem_review_packet_secure_atomic", {
      p_packet_id: packet.id,
      p_bearer_token_hash: sha256(parsed.data.token),
      p_access_code_hash: sha256(parsed.data.accessCode.trim().toUpperCase()),
      p_reviewer_email: parsed.data.reviewerEmail.trim().toLowerCase(),
      p_session_hash: sha256(session),
      p_session_expires_at: sessionExpiry,
      p_actor_hash: requestActorHash(request),
      p_snapshot_sha256: packet.snapshot_sha256,
      p_redeemed_at: redeemedAt,
    });
    if (updateError) return NextResponse.json({ error: /already redeemed/i.test(updateError.message) ? "This one-time review link has already been opened. Ask the agency to revoke it and create a new link if this was not you." : "The email, access code, or review link did not match." }, { status: 401, headers: noStoreJsonHeaders() });
    await logProductEvent({ eventType: "REVIEW_REDEEMED", recordId: packet.record_id, properties: { status: packet.decision ?? "OPEN" } });

    const response = NextResponse.json({ packetId, snapshot: await hydrateReviewEvidence(database, packet.snapshot), snapshotSha256: packet.snapshot_sha256, expiresAt: packet.expires_at, intendedReviewerEmail: packet.intended_reviewer_email, decision: packet.decision, reviewerName: packet.reviewer_name, reviewerEmail: packet.reviewer_email, reviewerNote: packet.reviewer_note, decidedAt: packet.decided_at, receiptSha256: packet.receipt_sha256 }, { headers: noStoreJsonHeaders() });
    response.cookies.set(reviewSessionCookieName(packetId), session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: `/`, maxAge: 2 * 60 * 60 });
    return response;
  } catch (error) {
    console.error("Review redemption failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "The review link could not be opened. Try again shortly." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
