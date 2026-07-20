import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { getOptionalUser } from "@/lib/supabase-server";

export async function GET(_request: Request, context: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await context.params;
  const session = (await cookies()).get("mp_review")?.value;
  const user = await getOptionalUser();
  if (!session && !user) return NextResponse.json({ error: "Open the secure review link or sign in as the milestone owner before exporting." }, { status: 401, headers: noStoreJsonHeaders() });

  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database.from("review_packets_v2")
      .select("record_id, public_id, session_hash, snapshot, snapshot_sha256, expires_at, revoked_at, decision, reviewer_name, reviewer_email, reviewer_note, intent_confirmed, electronic_records_consent, notice_version, country_code, decided_at, receipt_sha256, created_at")
      .eq("public_id", packetId)
      .single();
    if (error || !packet) return NextResponse.json({ error: "The review record was not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const reviewerAuthorized = Boolean(session && packet.session_hash === sha256(session));
    const { data: ownerRecord } = user ? await database.from("transaction_records").select("id").eq("id", packet.record_id).eq("owner_user_id", user.id).maybeSingle() : { data: null };
    if (!reviewerAuthorized && !ownerRecord) return NextResponse.json({ error: "The review session is invalid or this account does not own the record." }, { status: 401, headers: noStoreJsonHeaders() });
    if (!packet.decision) return NextResponse.json({ error: "A final decision has not been recorded yet." }, { status: 409, headers: noStoreJsonHeaders() });

    const { data: events, error: auditError } = await database.from("transaction_audit_events")
      .select("sequence, event_type, actor_type, actor_hash, payload, previous_hash, event_hash, occurred_at, retention_until")
      .eq("record_id", packet.record_id)
      .order("sequence", { ascending: true });
    if (auditError) throw new Error(auditError.message);

    const exportedAt = new Date().toISOString();
    const body = {
      format: "MilestoneProof transaction export v1",
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
        electronicRecordsConsent: packet.electronic_records_consent,
        noticeVersion: packet.notice_version,
        countryCode: packet.country_code,
        decidedAt: packet.decided_at,
        receiptSha256: packet.receipt_sha256,
      },
      retention: { packetCreatedAt: packet.created_at, reviewExpiresAt: packet.expires_at, policy: "See /records and /privacy" },
      auditChain: events ?? [],
    };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: {
        ...noStoreJsonHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="milestoneproof-${packetId}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The transaction export is unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
