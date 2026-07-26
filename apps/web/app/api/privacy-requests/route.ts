import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, publicRecordId, requestActorHash } from "@/lib/recordkeeping";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { randomToken, sha256 } from "@/lib/recordkeeping";
import { getOptionalUser, getSupabaseServerClient } from "@/lib/supabase-server";
import { readLimitedJsonResult } from "@/lib/request-security";
import {
  processPrivacyVerificationAccountCleanup,
  queuePrivacyVerificationAccountCleanup,
} from "@/lib/privacy-verification-cleanup";
import { logOperationalEvent } from "@/lib/operations";

const schema = z.object({
  requestType: z.enum(["ACCESS", "CORRECTION", "DELETION", "EXPORT", "OTHER"]),
  email: z.string().email().max(320),
  details: z.string().max(2_000).optional().default(""),
});

export async function POST(request: Request) {
  const quota = await consumeRateLimit(request, "privacy-request-day", 5, 86_400);
  if (!quota.allowed) return rateLimitedResponse(quota);
  const limited = await readLimitedJsonResult(request, 8_192);
  if (!limited.ok) return limited.response;
  const parsed = schema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid business email and request type." }, { status: 422, headers: noStoreJsonHeaders() });
  let verificationAccount: { authUserId: string; email: string; requestId: string } | null = null;
  let cleanupDatabase: ReturnType<typeof requireSupabaseAdmin> | null = null;
  try {
    const requestId = publicRecordId("PRIV");
    const database = requireSupabaseAdmin();
    cleanupDatabase = database;
    const email = parsed.data.email.trim().toLowerCase();
    const user = await getOptionalUser();
    const alreadyVerified = user?.email?.toLowerCase() === email;
    const verificationToken = randomToken();
    const verificationExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const { data: privacyRequest, error } = await database.from("privacy_requests_v2").insert({
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
    }).select("id").single();
    if (error || !privacyRequest) throw new Error(error?.message ?? "Privacy request persistence failed.");
    if (alreadyVerified) return NextResponse.json({ requestId, status: "VERIFYING", identityVerified: true }, { status: 201, headers: noStoreJsonHeaders() });

    const { data: authAccount, error: authError } = await database.auth.admin.createUser({ email, email_confirm: true, app_metadata: { privacy_verification_only: true } });
    const accountAlreadyExists = Boolean(authError && /already (been )?registered|already exists|email_exists|user_already_exists/i.test(`${authError.code ?? ""} ${authError.message}`));
    if (authError && !accountAlreadyExists) throw authError;
    if (authAccount.user) {
      verificationAccount = {
        authUserId: authAccount.user.id,
        email,
        requestId: privacyRequest.id,
      };
      await queuePrivacyVerificationAccountCleanup(database, {
        requestId: privacyRequest.id,
        authUserId: authAccount.user.id,
        email,
        cleanupAfter: verificationExpiresAt,
      });
    }
    const client = await getSupabaseServerClient();
    if (!client) throw new Error("Privacy email verification is not configured.");
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    const emailRedirectTo = `${origin}/privacy-request/verify?requestId=${encodeURIComponent(requestId)}&state=${encodeURIComponent(verificationToken)}`;
    const { error: signInError } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: false } });
    if (signInError) throw signInError;
    verificationAccount = null;
    return NextResponse.json({ requestId, status: "RECEIVED", verificationSent: true }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    if (cleanupDatabase && verificationAccount) {
      try {
        const cleanup = await queuePrivacyVerificationAccountCleanup(cleanupDatabase, {
          requestId: verificationAccount.requestId,
          authUserId: verificationAccount.authUserId,
          email: verificationAccount.email,
          cleanupAfter: new Date().toISOString(),
        });
        const cleanupResult = await processPrivacyVerificationAccountCleanup(cleanupDatabase, cleanup);
        if (!cleanupResult.ok) {
          await logOperationalEvent({
            severity: "ERROR",
            service: "privacy",
            eventType: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_FAILED",
            details: { requestId: verificationAccount.requestId, error: cleanupResult.error.slice(0, 1_000) },
          });
        }
      } catch (cleanupError) {
        // Auth and Postgres cannot commit atomically. If the durable queue is
        // unavailable, delete the account created in this request directly so
        // a failed email send cannot leave an untracked verification account.
        const { error: fallbackDeleteError } = await cleanupDatabase.auth.admin
          .deleteUser(verificationAccount.authUserId);
        await logOperationalEvent({
          severity: fallbackDeleteError ? "ERROR" : "WARN",
          service: "privacy",
          eventType: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_QUEUE_FAILED",
          details: {
            requestId: verificationAccount.requestId,
            fallbackDeleted: !fallbackDeleteError,
            error: cleanupError instanceof Error
              ? cleanupError.message.slice(0, 1_000)
              : "Cleanup queue failed",
          },
        });
      }
    }
    console.error("Privacy request submission failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "The privacy request or its verification email could not be completed. Try again shortly." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
