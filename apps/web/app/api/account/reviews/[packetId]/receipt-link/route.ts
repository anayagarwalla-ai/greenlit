import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { getOptionalUser } from "@/lib/supabase-server";

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "Sign in with the active beta account that owns this record." }, { status: 401, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error: packetError } = await database.from("review_packets_v2").select("id").eq("public_id", packetId).single();
    if (packetError || !packet) return NextResponse.json({ error: "Approval record not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const { error } = await database.rpc("mint_receipt_session_atomic", { p_packet_id: packet.id, p_owner_user_id: user.id, p_session_hash: sha256(token), p_expires_at: expiresAt, p_actor_hash: requestActorHash(request) });
    if (error) throw new Error(error.message);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    return NextResponse.json({ receiptUrl: `${origin}/receipt/${encodeURIComponent(packetId)}#t=${encodeURIComponent(token)}`, expiresAt }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The receipt link could not be created." }, { status: 409, headers: noStoreJsonHeaders() });
  }
}
