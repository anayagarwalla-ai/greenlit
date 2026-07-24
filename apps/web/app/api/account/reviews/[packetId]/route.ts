import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders, requestActorHash } from "@/lib/recordkeeping";
import { betaAccessAllowedFresh } from "@/lib/beta-access";

const schema = z.object({ action: z.enum(["revoke", "extend"]) });

export async function PATCH(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage review links." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "This account is no longer on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid review action." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: packet } = await database.from("review_packets_v2").select("id").eq("public_id", packetId).single();
    if (!packet) return NextResponse.json({ error: "Review packet not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const { data, error } = await database.rpc("manage_review_packet_atomic", { p_packet_id: packet.id, p_owner_user_id: user.id, p_action: parsed.data.action, p_actor_hash: requestActorHash(request), p_now: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { headers: noStoreJsonHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The review could not be updated.";
    console.error("Review management failed", message);
    return NextResponse.json({ error: /owner mismatch/i.test(message) ? "This account cannot manage that review." : /final|revoked|hard limit|unknown review|not found/i.test(message) ? "This review can no longer be changed." : "The review could not be updated right now." }, { status: /owner mismatch/i.test(message) ? 403 : /final|revoked|hard limit|unknown review|not found/i.test(message) ? 409 : 503, headers: noStoreJsonHeaders() });
  }
}
