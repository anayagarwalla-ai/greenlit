import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { sha256 } from "@/lib/recordkeeping";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import {
  processPrivacyVerificationAccountCleanup,
  queuePrivacyVerificationAccountCleanup,
} from "@/lib/privacy-verification-cleanup";
import { logOperationalEvent } from "@/lib/operations";

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
  const cleanupVerificationAccount = data.user.app_metadata?.privacy_verification_only === true;
  let cleanupDatabase: ReturnType<typeof requireSupabaseAdmin> | null = null;
  try {
    const database = requireSupabaseAdmin();
    cleanupDatabase = database;
    const { data: verification, error } = await database.rpc("complete_privacy_email_verification_atomic", {
      p_public_id: requestId,
      p_verification_token_hash: sha256(state),
      p_email: data.user.email,
      p_auth_user_id: data.user.id,
      p_verified_at: new Date().toISOString(),
      p_cleanup_verification_account: cleanupVerificationAccount,
    });
    if (error) throw error;
    await client.auth.signOut();
    const cleanupId = cleanupVerificationAccount && verification && typeof verification === "object"
      ? String((verification as { cleanupId?: unknown }).cleanupId ?? "")
      : "";
    if (cleanupId) {
      const { data: cleanup, error: cleanupReadError } = await database.from("privacy_verification_account_cleanups")
        .select("id,auth_user_id,attempts")
        .eq("id", cleanupId)
        .single();
      if (!cleanupReadError && cleanup) {
        const cleanupResult = await processPrivacyVerificationAccountCleanup(database, cleanup);
        if (!cleanupResult.ok) {
          await logOperationalEvent({
            severity: "ERROR",
            service: "privacy",
            eventType: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_FAILED",
            details: { requestId, cleanupId, error: cleanupResult.error.slice(0, 1_000) },
          });
        }
      } else {
        await logOperationalEvent({
          severity: "ERROR",
          service: "privacy",
          eventType: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_LOOKUP_FAILED",
          details: { requestId, cleanupId, error: cleanupReadError?.message ?? "Cleanup row missing" },
        });
      }
    }
    return NextResponse.redirect(new URL(`/privacy-request?verification=success&requestId=${encodeURIComponent(requestId)}`, url.origin));
  } catch (error) {
    console.error("Privacy identity verification failed", error instanceof Error ? error.message : "unknown");
    if (cleanupVerificationAccount && cleanupDatabase) {
      try {
        const cleanup = await queuePrivacyVerificationAccountCleanup(cleanupDatabase, {
          requestId: null,
          authUserId: data.user.id,
          email: data.user.email,
          cleanupAfter: new Date().toISOString(),
        });
        const cleanupResult = await processPrivacyVerificationAccountCleanup(
          cleanupDatabase,
          cleanup,
        );
        if (!cleanupResult.ok) {
          await logOperationalEvent({
            severity: "ERROR",
            service: "privacy",
            eventType: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_FAILED",
            details: { requestId, error: cleanupResult.error.slice(0, 1_000) },
          });
        }
      } catch (cleanupError) {
        const { error: fallbackDeleteError } = await cleanupDatabase.auth.admin
          .deleteUser(data.user.id);
        await logOperationalEvent({
          severity: fallbackDeleteError ? "ERROR" : "WARN",
          service: "privacy",
          eventType: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_QUEUE_FAILED",
          details: {
            requestId,
            fallbackDeleted: !fallbackDeleteError,
            error: cleanupError instanceof Error
              ? cleanupError.message.slice(0, 1_000)
              : "Cleanup queue failed",
          },
        });
      }
    }
    await client.auth.signOut();
    return NextResponse.redirect(new URL("/privacy-request?verification=invalid", url.origin));
  }
}
