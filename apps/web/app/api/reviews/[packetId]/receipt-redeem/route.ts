import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { randomToken, sha256 } from "@/lib/recordkeeping";
import { RECEIPT_SESSION_TTL_SECONDS, receiptSessionCookieName, receiptSessionExpiry } from "@/lib/review-session";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(32).max(512),
  accessCode: z.string().trim().min(8).max(32),
  recipientEmail: z.string().trim().email().max(320),
});

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const quota = await consumeRateLimit(request, "receipt-redeem-hour", 12, 3_600, null, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "This receipt link is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  const database = requireSupabaseAdmin();
  const { data: packet, error } = await database.from("review_packets_v2").select("id,decision").eq("public_id", packetId).single();
  if (error || !packet || !packet.decision) return NextResponse.json({ error: "The final receipt is unavailable." }, { status: 404, headers: noStoreJsonHeaders() });
  const session = randomToken();
  const sessionExpiresAt = receiptSessionExpiry();
  const { error: redeemError } = await database.rpc("redeem_receipt_session_secure_atomic", {
    p_packet_id: packet.id,
    p_token_hash: sha256(parsed.data.token),
    p_access_code_hash: sha256(parsed.data.accessCode.trim().toUpperCase()),
    p_recipient_email: parsed.data.recipientEmail.trim().toLowerCase(),
    p_session_hash: sha256(session),
    p_session_expires_at: sessionExpiresAt,
    p_redeemed_at: new Date().toISOString(),
  });
  if (redeemError) return NextResponse.json({ error: "This one-time receipt link, access code, or recipient email is invalid or expired. Ask the agency for a new link." }, { status: 410, headers: noStoreJsonHeaders() });
  const response = NextResponse.json({ redeemed: true }, { headers: noStoreJsonHeaders() });
  response.cookies.set(receiptSessionCookieName(packetId), session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: RECEIPT_SESSION_TTL_SECONDS });
  return response;
}
