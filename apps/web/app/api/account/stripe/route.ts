import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { deauthorizeStripeAccount, stripeConfigured } from "@/lib/stripe-api";
import { getOptionalUser } from "@/lib/supabase-server";

async function authenticatedUser() {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return null;
  return user;
}

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "Sign in with an invited account to manage Stripe." }, { status: 401, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  const { data, error } = await database.from("stripe_connections").select("stripe_account_id,livemode,status,connected_at,disconnected_at,last_error").eq("owner_user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Stripe connection status is temporarily unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ configured: stripeConfigured(), connection: data ? { accountId: data.stripe_account_id, livemode: data.livemode, status: data.status, connectedAt: data.connected_at, disconnectedAt: data.disconnected_at, lastError: data.last_error } : null }, { headers: noStoreJsonHeaders() });
}

export async function DELETE() {
  const user = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "Sign in with an invited account to manage Stripe." }, { status: 401, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  const { data } = await database.from("stripe_connections").select("stripe_account_id,status").eq("owner_user_id", user.id).maybeSingle();
  if (data?.status === "CONNECTED") {
    try { await deauthorizeStripeAccount(data.stripe_account_id); }
    catch { return NextResponse.json({ error: "Stripe could not be disconnected right now." }, { status: 502, headers: noStoreJsonHeaders() }); }
  }
  const { error } = await database.rpc("disconnect_stripe_account_atomic", { p_owner_user_id: user.id, p_disconnected_at: new Date().toISOString(), p_reason: "Agency owner disconnected Stripe from the dashboard." });
  if (error) return NextResponse.json({ error: "The Stripe connection could not be updated." }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ disconnected: true }, { headers: noStoreJsonHeaders() });
}
