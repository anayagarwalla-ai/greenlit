import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowed } from "@/lib/beta-access";

export async function GET() {
  const client = await getSupabaseServerClient();
  if (!client) return NextResponse.json({ user: null, configured: false }, { headers: noStoreJsonHeaders() });
  const { data } = await client.auth.getUser();
  return NextResponse.json({ user: data.user ? { id: data.user.id, email: data.user.email, betaAllowed: betaAccessAllowed(data.user) } : null, configured: true }, { headers: noStoreJsonHeaders() });
}

export async function DELETE() {
  const client = await getSupabaseServerClient();
  if (client) await client.auth.signOut();
  return NextResponse.json({ signedOut: true }, { headers: noStoreJsonHeaders() });
}
