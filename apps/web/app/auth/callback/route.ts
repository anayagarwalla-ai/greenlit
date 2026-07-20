import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") ?? "/dashboard";
  const next = requestedNext === "/workspace" ? "/workspace" : "/dashboard";
  const client = await getSupabaseServerClient();
  if (!code || !client) return NextResponse.redirect(new URL("/login?error=configuration", url.origin));
  const { error } = await client.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/login?error=expired" : next, url.origin));
}
