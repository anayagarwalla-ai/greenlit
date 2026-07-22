import { NextResponse } from "next/server";
import { z } from "zod";
import { betaEmailAllowed } from "@/lib/beta-access";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { requireSupabaseAdmin } from "@/lib/database";
import { logOperationalEvent } from "@/lib/operations";

const schema = z.object({ email: z.string().trim().email().max(320) });

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "invite-check-hour", 30, 3_600);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email." }, { status: 422, headers: noStoreJsonHeaders() });
  let identityReady = false;
  try {
    const database = requireSupabaseAdmin();
    const normalizedEmail = parsed.data.email.toLowerCase();
    const { data: existingInvite, error: inviteReadError } = await database.from("beta_invites").select("status").eq("email", normalizedEmail).maybeSingle();
    if (inviteReadError) throw inviteReadError;
    if (existingInvite?.status === "REMOVED") return NextResponse.json({ error: "This beta invitation was removed. Contact the Greenlit operator." }, { status: 403, headers: noStoreJsonHeaders() });
    if (!existingInvite && !betaEmailAllowed(normalizedEmail)) return NextResponse.json({ error: "This email is not on the closed-beta invite list. Ask the Greenlit operator for an invitation before signing in." }, { status: 403, headers: noStoreJsonHeaders() });
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
    identityReady = true;
    const { data: activatedInvite, error: activationError } = await database.from("beta_invites")
      .update({ status: "ACTIVE", last_sign_in_requested_at: new Date().toISOString(), removed_at: null })
      .eq("email", normalizedEmail).in("status", ["INVITED", "ACTIVE"]).select("id").single();
    if (activationError || !activatedInvite) throw activationError ?? new Error("The beta invitation could not be activated.");
    return NextResponse.json({ invited: true }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    await logOperationalEvent({ severity: "ERROR", service: "auth", eventType: "INVITE_PROVISION_FAILED", details: { message: error instanceof Error ? error.message : "Unknown invitation provisioning failure" } });
    return NextResponse.json({ error: identityReady ? "The account is ready, but beta activation did not finish. Retry this sign-in request; no sign-in link was sent." : "Account provisioning did not finish, and no sign-in link was sent. Retry in a moment or contact support." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
