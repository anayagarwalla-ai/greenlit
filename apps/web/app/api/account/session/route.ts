import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { sha256 } from "@/lib/recordkeeping";
import { cookies } from "next/headers";

export async function GET() {
  const client = await getSupabaseServerClient();
  if (!client) return NextResponse.json({ user: null, configured: false }, { headers: noStoreJsonHeaders() });
  const { data } = await client.auth.getUser();
  return NextResponse.json({ user: data.user ? { id: data.user.id, email: data.user.email, betaAllowed: await betaAccessAllowedFresh(data.user) } : null, configured: true }, { headers: noStoreJsonHeaders() });
}

export async function DELETE() {
  const store = await cookies();
  const relatedSessions = store.getAll().filter(({ name }) => name.startsWith("mp_review_") || name.startsWith("mp_receipt_"));
  if (relatedSessions.length) {
    try {
      const database = requireSupabaseAdmin();
      const reviewHashes = relatedSessions.filter(({ name }) => name.startsWith("mp_review_")).map(({ value }) => sha256(value));
      const receiptHashes = relatedSessions.filter(({ name }) => name.startsWith("mp_receipt_")).map(({ value }) => sha256(value));
      if (reviewHashes.length) await database.from("review_sessions_v2").update({ revoked_at: new Date().toISOString() }).in("session_hash", reviewHashes);
      if (receiptHashes.length) await database.from("receipt_sessions_v2").update({ revoked_at: new Date().toISOString() }).in("session_hash", receiptHashes);
    } catch (error) {
      console.error("Related review session cleanup failed", error instanceof Error ? error.message : "unknown");
    }
  }
  const client = await getSupabaseServerClient();
  if (client) await client.auth.signOut();
  const response = NextResponse.json({ signedOut: true }, { headers: noStoreJsonHeaders() });
  response.cookies.set("mp_owner", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  for (const { name } of relatedSessions) response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
