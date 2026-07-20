import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOptionalUser } from "@/lib/supabase-server";
import { appendAuditEvent, noStoreJsonHeaders, requestActorHash } from "@/lib/recordkeeping";

const schema = z.object({ action: z.enum(["revoke", "extend"]) });

export async function PATCH(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage review links." }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid review action." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: packet } = await database.from("review_packets_v2").select("id, record_id, decision, created_at").eq("public_id", packetId).single();
    if (!packet) return NextResponse.json({ error: "Review packet not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const { data: record } = await database.from("transaction_records").select("id").eq("id", packet.record_id).eq("owner_user_id", user.id).single();
    if (!record) return NextResponse.json({ error: "This account cannot manage the review." }, { status: 403, headers: noStoreJsonHeaders() });
    if (packet.decision) return NextResponse.json({ error: "A final client decision cannot be revoked or extended." }, { status: 409, headers: noStoreJsonHeaders() });
    if (parsed.data.action === "revoke") {
      const revokedAt = new Date().toISOString();
      const { error } = await database.from("review_packets_v2").update({ revoked_at: revokedAt }).eq("id", packet.id).is("decision", null);
      if (error) throw new Error(error.message);
      await appendAuditEvent({ recordId: packet.record_id, eventType: "REVIEW_PACKET_REVOKED", actorType: "OWNER", actorHash: requestActorHash(request), payload: { packetId, revokedAt } });
      return NextResponse.json({ revokedAt }, { headers: noStoreJsonHeaders() });
    }
    const hardLimit = new Date(new Date(packet.created_at).getTime() + 14 * 24 * 60 * 60_000);
    if (hardLimit.getTime() <= Date.now()) return NextResponse.json({ error: "This review link reached its 14-day hard limit. Create a new review link instead." }, { status: 410, headers: noStoreJsonHeaders() });
    const expiresAt = new Date(Math.min(Date.now() + 72 * 60 * 60_000, hardLimit.getTime())).toISOString();
    const { data: extended, error } = await database.from("review_packets_v2").update({ expires_at: expiresAt }).eq("id", packet.id).is("decision", null).is("revoked_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!extended) return NextResponse.json({ error: "This review link is no longer active. Create a new review link instead." }, { status: 409, headers: noStoreJsonHeaders() });
    await appendAuditEvent({ recordId: packet.record_id, eventType: "REVIEW_PACKET_EXTENDED", actorType: "OWNER", actorHash: requestActorHash(request), payload: { packetId, expiresAt } });
    return NextResponse.json({ expiresAt }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The review could not be updated." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
