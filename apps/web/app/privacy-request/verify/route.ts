import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { sha256 } from "@/lib/recordkeeping";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestId = url.searchParams.get("requestId");
  const state = url.searchParams.get("state");
  const client = await getSupabaseServerClient();
  if (!client || !code || !requestId || !state) return NextResponse.redirect(new URL("/privacy-request?verification=invalid", url.origin));
  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError) return NextResponse.redirect(new URL("/privacy-request?verification=expired", url.origin));
  const { data } = await client.auth.getUser();
  if (!data.user?.email) {
    await client.auth.signOut();
    return NextResponse.redirect(new URL("/privacy-request?verification=invalid", url.origin));
  }
  try {
    const database = requireSupabaseAdmin();
    const { error } = await database.rpc("complete_privacy_email_verification_atomic", {
      p_public_id: requestId,
      p_verification_token_hash: sha256(state),
      p_email: data.user.email,
      p_auth_user_id: data.user.id,
      p_verified_at: new Date().toISOString(),
    });
    if (error) throw error;
    await client.auth.signOut();
    return NextResponse.redirect(new URL(`/privacy-request?verification=success&requestId=${encodeURIComponent(requestId)}`, url.origin));
  } catch (error) {
    console.error("Privacy identity verification failed", error instanceof Error ? error.message : "unknown");
    await client.auth.signOut();
    return NextResponse.redirect(new URL("/privacy-request?verification=invalid", url.origin));
  }
}
