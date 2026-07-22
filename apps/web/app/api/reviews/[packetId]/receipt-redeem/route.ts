import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { receiptSessionAuthorized, receiptSessionCookieName } from "@/lib/review-session";

const schema = z.object({ token: z.string().min(32).max(512) });

export async function POST(request: Request, context: { params: Promise<{ packetId: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "This receipt link is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  const { packetId } = await context.params;
  const database = requireSupabaseAdmin();
  const { data: packet, error } = await database.from("review_packets_v2").select("id,decision").eq("public_id", packetId).single();
  if (error || !packet || !packet.decision) return NextResponse.json({ error: "The final receipt is unavailable." }, { status: 404, headers: noStoreJsonHeaders() });
  if (!await receiptSessionAuthorized(database, packet.id, parsed.data.token)) return NextResponse.json({ error: "This receipt link is invalid or expired. Ask the agency for a new authorized receipt link." }, { status: 410, headers: noStoreJsonHeaders() });
  const response = NextResponse.json({ redeemed: true }, { headers: noStoreJsonHeaders() });
  response.cookies.set(receiptSessionCookieName(packetId), parsed.data.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 7 * 24 * 60 * 60 });
  return response;
}
