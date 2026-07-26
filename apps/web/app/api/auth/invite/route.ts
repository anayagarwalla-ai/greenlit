import { NextResponse } from "next/server";
import { z } from "zod";
import { betaEmailAllowed } from "@/lib/beta-access";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { requireSupabaseAdmin } from "@/lib/database";
import { logOperationalEvent } from "@/lib/operations";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { safeAuthNext } from "@/lib/auth-next";
import { readLimitedJsonResult } from "@/lib/request-security";

const schema = z.object({ email: z.string().trim().email().max(320), nextPath: z.string().max(1_000).optional() });

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "invite-check-hour", 30, 3_600);
  if (!quota.allowed) return rateLimitedResponse(quota);
  const limited = await readLimitedJsonResult(request, 8_192);
  if (!limited.ok) return limited.response;
  const parsed = schema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const normalizedEmail = parsed.data.email.toLowerCase();
    const { data: existingInvite, error: inviteReadError } = await database.from("beta_invites").select("status").eq("email", normalizedEmail).maybeSingle();
    if (inviteReadError) throw inviteReadError;
    // Always return the same public response. Whether an address is invited is
    // account information and must not be exposed as an email-membership oracle.
    if (existingInvite?.status === "REMOVED" || (!existingInvite && !betaEmailAllowed(normalizedEmail))) {
      return NextResponse.json({ accepted: true }, { headers: noStoreJsonHeaders() });
    }
    if (!existingInvite) {
      const { error: reservationError } = await database.from("beta_invites").insert({ email: normalizedEmail, status: "INVITED", adult_sponsor: process.env.NEXT_PUBLIC_OPERATOR_NAME || null, invited_by: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "configured allowlist", last_sign_in_requested_at: null, removed_at: null });
      if (reservationError) throw reservationError;
    }
    // The browser is never allowed to create users. Only this server-side,
    // allowlist-gated step can provision an identity, and the durable INVITED
    // reservation above exists before Supabase Auth is touched.
    const { error: authError } = await database.auth.admin.createUser({ email: normalizedEmail, email_confirm: true });
    const accountAlreadyExists = Boolean(authError && /already (been )?registered|already exists|email_exists|user_already_exists/i.test(`${authError.code ?? ""} ${authError.message}`));
    if (authError && !accountAlreadyExists) throw authError;
    const { data: requestedInvite, error: requestError } = await database.from("beta_invites")
      .update({ last_sign_in_requested_at: new Date().toISOString(), removed_at: null })
      .eq("email", normalizedEmail).in("status", ["INVITED", "ACTIVE"]).select("id").single();
    if (requestError || !requestedInvite) throw requestError ?? new Error("The beta invitation could not be prepared.");
    const client = await getSupabaseServerClient();
    if (!client) throw new Error("Agency sign-in is not configured.");
    const next = safeAuthNext(parsed.data.nextPath);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    const { error: signInError } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: false },
    });
    if (signInError) throw signInError;
    return NextResponse.json({ accepted: true }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    await logOperationalEvent({ severity: "ERROR", service: "auth", eventType: "INVITE_PROVISION_FAILED", details: { message: error instanceof Error ? error.message : "Unknown invitation provisioning failure" } });
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Retry in a moment or contact support." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
