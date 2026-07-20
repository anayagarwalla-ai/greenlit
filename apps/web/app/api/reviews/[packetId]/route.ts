import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";

export async function GET(_request: Request, context: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await context.params;
  const session = (await cookies()).get("mp_review")?.value;
  if (!session) return NextResponse.json({ error: "Open the secure review link to continue." }, { status: 401, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2").select("record_id, snapshot, snapshot_sha256, expires_at, decision, reviewer_name, reviewer_email, reviewer_note, decided_at, receipt_sha256").eq("public_id", packetId).eq("session_hash", sha256(session)).single();
    if (error || !packet) return NextResponse.json({ error: "The review session is invalid or has been replaced." }, { status: 401, headers: noStoreJsonHeaders() });
    if (!packet.decision && new Date(packet.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This review packet has expired." }, { status: 410, headers: noStoreJsonHeaders() });
    const { data: auditHead } = await database.from("transaction_audit_events").select("sequence, event_hash, occurred_at").eq("record_id", packet.record_id).order("sequence", { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({ packetId, snapshot: packet.snapshot, snapshotSha256: packet.snapshot_sha256, expiresAt: packet.expires_at, decision: packet.decision, reviewerName: packet.reviewer_name, reviewerEmail: packet.reviewer_email, reviewerNote: packet.reviewer_note, decidedAt: packet.decided_at, receiptSha256: packet.receipt_sha256, auditHead: auditHead ? { sequence: auditHead.sequence, eventHash: auditHead.event_hash, occurredAt: auditHead.occurred_at } : null }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The review record is unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
