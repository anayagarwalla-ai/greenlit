import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { logOperationalEvent } from "@/lib/operations";
import { sha256 } from "@/lib/recordkeeping";
import { deauthorizeStripeAccount, exchangeStripeCode } from "@/lib/stripe-api";
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
  const { data: existingConnection, error: existingConnectionError } = await database
    .from("stripe_connections")
    .select("stripe_account_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (existingConnectionError) {
    await logOperationalEvent({ severity: "ERROR", service: "stripe", eventType: "STRIPE_OAUTH_STATE_FAILED", details: { ownerUserId: user.id, message: existingConnectionError.message } });
    return dashboard(origin, "failed");
  }
  const { data: consumed, error: stateError } = await database.rpc("consume_stripe_oauth_state_atomic", { p_state_hash: sha256(state), p_owner_user_id: user.id, p_now: new Date().toISOString() });
  if (stateError || !consumed) return dashboard(origin, "invalid-state");
  let authorizedAccountId: string | null = null;
  try {
    const token = await exchangeStripeCode(code);
    const accountId = token.stripe_user_id ?? token.account_id;
    if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("Stripe did not return a valid connected account.");
    authorizedAccountId = accountId;
    if (token.livemode && process.env.STRIPE_ALLOW_LIVE_MODE !== "true") throw new Error("Only a Stripe test-mode account can be connected during the beta.");
    if (existingConnection?.stripe_account_id && existingConnection.stripe_account_id !== accountId) {
      await deauthorizeStripeAccount(existingConnection.stripe_account_id);
      const { error: disconnectError } = await database.rpc("disconnect_stripe_account_atomic", {
        p_owner_user_id: user.id,
        p_disconnected_at: new Date().toISOString(),
        p_reason: "Replaced by a newly authorized Stripe account.",
      });
      if (disconnectError) throw new Error(`The previous Stripe connection could not be retired: ${disconnectError.message}`);
    }
    const connectedAt = new Date().toISOString();
    const { error } = await database.rpc("connect_stripe_account_atomic", {
      p_owner_user_id: user.id, p_stripe_account_id: accountId, p_livemode: token.livemode,
      p_access_ciphertext: encryptStripeSecret(token.access_token), p_refresh_ciphertext: encryptStripeSecret(token.refresh_token),
      p_access_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(), p_connected_at: connectedAt,
    });
    if (error) throw new Error(error.message);
    return dashboard(origin, "connected");
  } catch (error) {
    let deauthorizationError: string | null = null;
    if (authorizedAccountId && existingConnection?.stripe_account_id !== authorizedAccountId) {
      try {
        await deauthorizeStripeAccount(authorizedAccountId);
      } catch (cleanupError) {
        deauthorizationError = cleanupError instanceof Error ? cleanupError.message : "Unknown Stripe deauthorization failure";
      }
    }
    await logOperationalEvent({
      severity: "ERROR",
      service: "stripe",
      eventType: deauthorizationError ? "STRIPE_OAUTH_CLEANUP_FAILED" : "STRIPE_OAUTH_FAILED",
      details: {
        ownerUserId: user.id,
        message: error instanceof Error ? error.message : "Unknown OAuth failure",
        orphanedAccountId: deauthorizationError ? authorizedAccountId : null,
        cleanupError: deauthorizationError,
      },
    });
    return dashboard(origin, "failed");
  }
}
