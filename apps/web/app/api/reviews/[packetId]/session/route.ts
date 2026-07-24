import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { receiptSessionCookieName, reviewSessionCookieName } from "@/lib/review-session";

export async function DELETE(_request: Request, context: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await context.params;
  const store = await cookies();
  const reviewCookie = reviewSessionCookieName(packetId);
  const receiptCookie = receiptSessionCookieName(packetId);
  const reviewSession = store.get(reviewCookie)?.value;
  const receiptSession = store.get(receiptCookie)?.value;

  try {
    const database = requireSupabaseAdmin();
    const { data: packet } = await database.from("review_packets_v2").select("id").eq("public_id", packetId).maybeSingle();
    if (packet) {
      if (reviewSession) await database.from("review_sessions_v2").update({ revoked_at: new Date().toISOString() }).eq("packet_id", packet.id).eq("session_hash", sha256(reviewSession));
      if (receiptSession) await database.from("receipt_sessions_v2").update({ revoked_at: new Date().toISOString() }).eq("packet_id", packet.id).eq("session_hash", sha256(receiptSession));
    }
  } catch (error) {
    console.error("Review session revocation failed", error instanceof Error ? error.message : "unknown");
  }

  const response = NextResponse.json({ ended: true }, { headers: noStoreJsonHeaders() });
  response.cookies.set(reviewCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  response.cookies.set(receiptCookie, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
