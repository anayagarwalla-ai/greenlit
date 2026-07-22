import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { logOperationalEvent } from "@/lib/operations";
import { sha256 } from "@/lib/recordkeeping";
import { exchangeStripeCode } from "@/lib/stripe-api";
import { encryptStripeSecret } from "@/lib/stripe-crypto";
import { getOptionalUser } from "@/lib/supabase-server";

function dashboard(origin: string, state: string) { return NextResponse.redirect(new URL(`/dashboard?stripe=${state}`, origin)); }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return dashboard(origin, "session-expired");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return dashboard(origin, "cancelled");
  const database = requireSupabaseAdmin();
  const { data: consumed, error: stateError } = await database.rpc("consume_stripe_oauth_state_atomic", { p_state_hash: sha256(state), p_owner_user_id: user.id, p_now: new Date().toISOString() });
  if (stateError || !consumed) return dashboard(origin, "invalid-state");
  try {
    const token = await exchangeStripeCode(code);
    if (token.livemode && process.env.STRIPE_ALLOW_LIVE_MODE !== "true") throw new Error("Only a Stripe test-mode account can be connected during the beta.");
    const accountId = token.stripe_user_id ?? token.account_id;
    if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("Stripe did not return a valid connected account.");
    const { error } = await database.from("stripe_connections").upsert({
      owner_user_id: user.id,
      stripe_account_id: accountId,
      livemode: token.livemode,
      status: "CONNECTED",
      access_token_ciphertext: encryptStripeSecret(token.access_token),
      refresh_token_ciphertext: encryptStripeSecret(token.refresh_token),
      access_token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_error: null,
    }, { onConflict: "owner_user_id" });
    if (error) throw new Error(error.message);
    return dashboard(origin, "connected");
  } catch (error) {
    await logOperationalEvent({ severity: "ERROR", service: "stripe", eventType: "STRIPE_OAUTH_FAILED", details: { ownerUserId: user.id, message: error instanceof Error ? error.message : "Unknown OAuth failure" } });
    return dashboard(origin, "failed");
  }
}
