import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, publicRecordId, requestActorHash } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { randomToken, sha256 } from "@/lib/recordkeeping";
import { getOptionalUser, getSupabaseServerClient } from "@/lib/supabase-server";

const schema = z.object({
  requestType: z.enum(["ACCESS", "CORRECTION", "DELETION", "EXPORT", "OTHER"]),
  email: z.string().email().max(320),
  details: z.string().max(2_000).optional().default(""),
});

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "privacy-request-day", 5, 86_400);
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email and request type." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const requestId = publicRecordId("PRIV");
    const database = requireSupabaseAdmin();
    const email = parsed.data.email.trim().toLowerCase();
    const user = await getOptionalUser();
    const alreadyVerified = user?.email?.toLowerCase() === email;
    const verificationToken = randomToken();
    const verificationExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const { error } = await database.from("privacy_requests_v2").insert({
      public_id: requestId,
      request_type: parsed.data.requestType,
      email,
      details: parsed.data.details || null,
      actor_hash: requestActorHash(request),
      status: alreadyVerified ? "VERIFYING" : "RECEIVED",
      identity_verified_at: alreadyVerified ? new Date().toISOString() : null,
      verification_method: alreadyVerified ? "EXISTING_AUTH_SESSION" : null,
      verified_auth_user_id: alreadyVerified ? user.id : null,
      verification_token_hash: alreadyVerified ? null : sha256(verificationToken),
      verification_expires_at: alreadyVerified ? null : verificationExpiresAt,
    });
    if (error) throw new Error(error.message);
    if (alreadyVerified) return NextResponse.json({ requestId, status: "VERIFYING", identityVerified: true }, { status: 201, headers: noStoreJsonHeaders() });

    const { error: authError } = await database.auth.admin.createUser({ email, email_confirm: true, app_metadata: { privacy_verification_only: true } });
    const accountAlreadyExists = Boolean(authError && /already (been )?registered|already exists|email_exists|user_already_exists/i.test(`${authError.code ?? ""} ${authError.message}`));
    if (authError && !accountAlreadyExists) throw authError;
    const client = await getSupabaseServerClient();
    if (!client) throw new Error("Privacy email verification is not configured.");
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    const emailRedirectTo = `${origin}/privacy-request/verify?requestId=${encodeURIComponent(requestId)}&state=${encodeURIComponent(verificationToken)}`;
    const { error: signInError } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: false } });
    if (signInError) throw signInError;
    return NextResponse.json({ requestId, status: "RECEIVED", verificationSent: true }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Privacy request submission failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "The privacy request or its verification email could not be completed. Try again shortly." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
