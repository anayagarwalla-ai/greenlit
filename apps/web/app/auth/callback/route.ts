import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { betaAccessAllowed } from "@/lib/beta-access";
import { safeAuthNext } from "@/lib/auth-next";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeAuthNext(url.searchParams.get("next"));
  const client = await getSupabaseServerClient();
  if (!code || !client) return NextResponse.redirect(new URL("/login?error=configuration", url.origin));
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=expired", url.origin));
  const { data } = await client.auth.getUser();
  if (!data.user || !betaAccessAllowed(data.user)) {
    await client.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not-invited", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
