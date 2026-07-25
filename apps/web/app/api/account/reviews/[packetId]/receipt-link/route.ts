import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { getOptionalUser } from "@/lib/supabase-server";
import { receiptSessionExpiry } from "@/lib/review-session";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({ recipientEmail: z.string().trim().email().max(320) });

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "Sign in with the active beta account that owns this record." }, { status: 401, headers: noStoreJsonHeaders() });
  const quota = await consumeRateLimit(request, "receipt-link-day", 20, 86_400, user.id, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the business email that should receive this receipt." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error: packetError } = await database.from("review_packets_v2").select("id").eq("public_id", packetId).single();
    if (packetError || !packet) return NextResponse.json({ error: "Approval record not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const token = randomToken();
    const accessCode = sha256(randomToken()).slice(0, 12).toUpperCase();
    const recipientEmail = parsed.data.recipientEmail.trim().toLowerCase();
    const expiresAt = receiptSessionExpiry();
    const { data: grantId, error } = await database.rpc("mint_receipt_session_secure_atomic", {
      p_packet_id: packet.id,
      p_owner_user_id: user.id,
      p_token_hash: sha256(token),
      p_access_code_hash: sha256(accessCode),
      p_recipient_email: recipientEmail,
      p_expires_at: expiresAt,
      p_actor_hash: requestActorHash(request),
    });
    if (error) throw new Error(error.message);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    return NextResponse.json({ grantId, receiptUrl: `${origin}/receipt/${encodeURIComponent(packetId)}#t=${encodeURIComponent(token)}`, accessCode, recipientEmail, expiresAt }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Receipt grant creation failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "The receipt link could not be created. Confirm the approval still belongs to this account." }, { status: 409, headers: noStoreJsonHeaders() });
  }
}
