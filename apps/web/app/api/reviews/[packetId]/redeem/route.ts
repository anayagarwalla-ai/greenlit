import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, noStoreJsonHeaders, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";

const schema = z.object({ token: z.string().min(20).max(200) });

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The review token is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2").select("id, record_id, snapshot, snapshot_sha256, expires_at, decision, reviewer_name, reviewer_note, decided_at, receipt_sha256").eq("public_id", packetId).eq("bearer_token_hash", sha256(parsed.data.token)).single();
    if (error || !packet) return NextResponse.json({ error: "This review link is invalid." }, { status: 404, headers: noStoreJsonHeaders() });
    if (new Date(packet.expires_at).getTime() <= Date.now() && !packet.decision) return NextResponse.json({ error: "This review link has expired." }, { status: 410, headers: noStoreJsonHeaders() });

    const session = randomToken();
    const { error: updateError } = await database.from("review_packets_v2").update({ session_hash: sha256(session) }).eq("id", packet.id);
    if (updateError) throw new Error(updateError.message);
    await appendAuditEvent({ recordId: packet.record_id, eventType: "REVIEW_LINK_REDEEMED", actorType: "REVIEWER", actorHash: requestActorHash(request), payload: { packetId, snapshotSha256: packet.snapshot_sha256 } });

    const response = NextResponse.json({ packetId, snapshot: packet.snapshot, snapshotSha256: packet.snapshot_sha256, expiresAt: packet.expires_at, decision: packet.decision, reviewerName: packet.reviewer_name, reviewerNote: packet.reviewer_note, decidedAt: packet.decided_at, receiptSha256: packet.receipt_sha256 }, { headers: noStoreJsonHeaders() });
    response.cookies.set("mp_review", session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 72 * 60 * 60 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The review link could not be opened." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

