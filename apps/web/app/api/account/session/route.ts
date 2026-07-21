import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowedFresh } from "@/lib/beta-access";

export async function GET() {
  const client = await getSupabaseServerClient();
  if (!client) return NextResponse.json({ user: null, configured: false }, { headers: noStoreJsonHeaders() });
  const { data } = await client.auth.getUser();
  return NextResponse.json({ user: data.user ? { id: data.user.id, email: data.user.email, betaAllowed: await betaAccessAllowedFresh(data.user) } : null, configured: true }, { headers: noStoreJsonHeaders() });
}

export async function DELETE() {
  const client = await getSupabaseServerClient();
  if (client) await client.auth.signOut();
  const response = NextResponse.json({ signedOut: true }, { headers: noStoreJsonHeaders() });
  response.cookies.set("mp_owner", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
