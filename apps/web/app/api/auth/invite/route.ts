import { NextResponse } from "next/server";
import { z } from "zod";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { requireSupabaseAdmin } from "@/lib/database";

const schema = z.object({ email: z.string().trim().email().max(320) });

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "invite-check-hour", 30, 3_600);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email." }, { status: 422, headers: noStoreJsonHeaders() });
  if (!await betaAccessAllowedFresh(parsed.data.email)) {
    return NextResponse.json({ error: "This email is not on the closed-beta invite list. Ask the Greenlit operator for an invitation before signing in." }, { status: 403, headers: noStoreJsonHeaders() });
  }
  try {
    const database = requireSupabaseAdmin();
    const normalizedEmail = parsed.data.email.toLowerCase();
    const { data: existingInvite, error: inviteReadError } = await database.from("beta_invites").select("status").eq("email", normalizedEmail).maybeSingle();
    if (inviteReadError) throw inviteReadError;
    if (existingInvite?.status === "REMOVED") return NextResponse.json({ error: "This beta invitation was removed. Contact the Greenlit operator." }, { status: 403, headers: noStoreJsonHeaders() });
    const ledger = existingInvite
      ? await database.from("beta_invites").update({ last_sign_in_requested_at: new Date().toISOString() }).eq("email", normalizedEmail).eq("status", "ACTIVE")
      : await database.from("beta_invites").insert({ email: normalizedEmail, status: "ACTIVE", adult_sponsor: process.env.NEXT_PUBLIC_OPERATOR_NAME || null, invited_by: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "configured allowlist", last_sign_in_requested_at: new Date().toISOString(), removed_at: null });
    const ledgerError = ledger.error;
    if (ledgerError) throw ledgerError;
    // The browser is never allowed to create users. Only this server-side,
    // allowlist-gated step can provision the invited identity.
    const { error } = await database.auth.admin.createUser({ email: normalizedEmail, email_confirm: true });
    if (error && !/already (been )?registered|already exists|email_exists|user_already_exists/i.test(`${error.code ?? ""} ${error.message}`)) throw error;
    return NextResponse.json({ invited: true }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "Agency sign-in is temporarily unavailable. The invitation was not used and no account was created." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
