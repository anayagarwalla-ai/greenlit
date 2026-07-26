import type { SupabaseClient } from "@supabase/supabase-js";

export const PRIVACY_VERIFICATION_CLEANUP_RETENTION_DAYS = 7;
export const PRIVACY_ACCOUNT_DELETION_RECEIPT_DAYS = 30;
export const PRIVACY_VERIFICATION_CLEANUP_EXPORT_FIELDS =
  "status,disposition,requested_at,cleanup_after,completed_at";

export type PrivacyVerificationCleanup = {
  id: string;
  auth_user_id: string;
  attempts: number | null;
};

export type PrivacyVerificationCleanupDisposition =
  | "DELETED"
  | "ALREADY_ABSENT"
  | "PRESERVED_ACTIVE_ACCOUNT";

export function shouldPreservePrivacyVerificationAccount(
  recordCount: number,
  inviteStatus: string | null | undefined,
) {
  return recordCount > 0 || inviteStatus === "ACTIVE" || inviteStatus === "INVITED";
}

export function retentionRetryAt(attempts: number, now = new Date()) {
  const exponent = Math.min(Math.max(attempts - 1, 0), 16);
  const delayMinutes = Math.min(24 * 60, 5 * (2 ** exponent));
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

export async function queuePrivacyVerificationAccountCleanup(
  database: SupabaseClient,
  input: {
    requestId: string | null;
    authUserId: string;
    email: string;
    cleanupAfter: string;
    now?: string;
  },
): Promise<PrivacyVerificationCleanup> {
  const queuedAt = input.now ?? new Date().toISOString();
  const { data, error } = await database.rpc(
    "queue_privacy_verification_account_cleanup_atomic",
    {
      p_request_id: input.requestId,
      p_auth_user_id: input.authUserId,
      p_email: input.email.trim().toLowerCase(),
      p_cleanup_after: input.cleanupAfter,
      p_now: queuedAt,
    },
  );
  if (error) throw new Error(error.message);
  const cleanupId = data && typeof data === "object"
    ? String((data as { cleanupId?: unknown }).cleanupId ?? "")
    : "";
  if (!cleanupId) throw new Error("Privacy verification cleanup was not queued.");
  const { data: cleanup, error: readError } = await database
    .from("privacy_verification_account_cleanups")
    .select("id,auth_user_id,attempts")
    .eq("id", cleanupId)
    .single();
  if (readError || !cleanup) {
    throw new Error(readError?.message ?? "Privacy verification cleanup row is unavailable.");
  }
  return cleanup as PrivacyVerificationCleanup;
}

export async function processPrivacyVerificationAccountCleanup(
  database: SupabaseClient,
  cleanup: PrivacyVerificationCleanup,
): Promise<
  | { ok: true; disposition: PrivacyVerificationCleanupDisposition }
  | { ok: false; error: string }
> {
  const attempts = Number(cleanup.attempts ?? 0) + 1;
  try {
    const [{ count, error: recordCountError }, { data: account, error: accountError }] = await Promise.all([
      database.from("transaction_records")
        .select("id", { head: true, count: "exact" })
        .eq("owner_user_id", cleanup.auth_user_id),
      database.auth.admin.getUserById(cleanup.auth_user_id),
    ]);
    if (recordCountError) throw new Error(recordCountError.message);
    if (accountError && !/not found/i.test(accountError.message)) throw new Error(accountError.message);

    let disposition: PrivacyVerificationCleanupDisposition;
    if (!account?.user) {
      disposition = "ALREADY_ABSENT";
    } else {
      const normalizedEmail = account.user.email?.trim().toLowerCase();
      const { data: invite, error: inviteError } = normalizedEmail
        ? await database.from("beta_invites")
          .select("status")
          .eq("email", normalizedEmail)
          .maybeSingle()
        : { data: null, error: null };
      if (inviteError) throw new Error(inviteError.message);
      if (shouldPreservePrivacyVerificationAccount(count ?? 0, invite?.status)) {
        const { error: updateError } = await database.auth.admin.updateUserById(cleanup.auth_user_id, {
          app_metadata: {
            ...account.user.app_metadata,
            privacy_verification_only: false,
          },
        });
        if (updateError) throw new Error(updateError.message);
        disposition = "PRESERVED_ACTIVE_ACCOUNT";
      } else {
        const { error: deleteError } = await database.auth.admin.deleteUser(cleanup.auth_user_id);
        if (deleteError && !/not found/i.test(deleteError.message)) throw new Error(deleteError.message);
        disposition = deleteError ? "ALREADY_ABSENT" : "DELETED";
      }
    }

    const completedAt = new Date();
    const { error: updateQueueError } = await database.from("privacy_verification_account_cleanups")
      .update({
        status: "COMPLETED",
        disposition,
        attempts,
        last_error: null,
        completed_at: completedAt.toISOString(),
        retention_until: new Date(
          completedAt.getTime() + PRIVACY_VERIFICATION_CLEANUP_RETENTION_DAYS * 86_400_000,
        ).toISOString(),
      })
      .eq("id", cleanup.id);
    if (updateQueueError) throw new Error(updateQueueError.message);
    return { ok: true, disposition };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Privacy verification account cleanup failed";
    await database.from("privacy_verification_account_cleanups")
      .update({
        status: "FAILED",
        attempts,
        last_error: message.slice(0, 1_000),
        cleanup_after: retentionRetryAt(attempts),
      })
      .eq("id", cleanup.id);
    return { ok: false, error: message };
  }
}
