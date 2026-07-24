import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { randomToken, sha256 } from "@/lib/recordkeeping";
import { stripeConfigured, stripeInstallUrl } from "@/lib/stripe-api";
import { getOptionalUser } from "@/lib/supabase-server";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const user = await getOptionalUser();
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.redirect(new URL("/login?error=invite-required", origin));
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return NextResponse.redirect(new URL("/dashboard?stripe=cross-site-blocked", origin));
  const quota = await consumeRateLimit(request, "stripe-install-hour", 5, 3_600, user.id, { failClosed: true });
  if (!quota.allowed) return NextResponse.redirect(new URL("/dashboard?stripe=rate-limited", origin));
  if (!stripeConfigured()) return NextResponse.redirect(new URL("/dashboard?stripe=not-configured", origin));
  const state = randomToken();
  const database = requireSupabaseAdmin();
  const { error } = await database.from("stripe_oauth_states").insert({ state_hash: sha256(state), owner_user_id: user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  if (error) return NextResponse.redirect(new URL("/dashboard?stripe=state-failed", origin));
  return NextResponse.redirect(stripeInstallUrl(origin, state));
}
