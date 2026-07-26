import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  PRIVACY_VERIFICATION_CLEANUP_EXPORT_FIELDS,
  processPrivacyVerificationAccountCleanup,
  queuePrivacyVerificationAccountCleanup,
  retentionRetryAt,
  shouldPreservePrivacyVerificationAccount,
} from "./privacy-verification-cleanup";

describe("privacy verification Auth cleanup classification", () => {
  it("deletes an account created only for email verification", () => {
    expect(shouldPreservePrivacyVerificationAccount(0, null)).toBe(false);
    expect(shouldPreservePrivacyVerificationAccount(0, "REMOVED")).toBe(false);
  });

  it("preserves accounts with retained records or active beta access", () => {
    expect(shouldPreservePrivacyVerificationAccount(1, null)).toBe(true);
    expect(shouldPreservePrivacyVerificationAccount(0, "INVITED")).toBe(true);
    expect(shouldPreservePrivacyVerificationAccount(0, "ACTIVE")).toBe(true);
  });

  it("backs retries off exponentially with a one-day cap", () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    expect(retentionRetryAt(1, now)).toBe("2026-07-26T12:05:00.000Z");
    expect(retentionRetryAt(4, now)).toBe("2026-07-26T12:40:00.000Z");
    expect(retentionRetryAt(99, now)).toBe("2026-07-27T12:00:00.000Z");
  });

  it("exports only subject-facing cleanup state", () => {
    expect(PRIVACY_VERIFICATION_CLEANUP_EXPORT_FIELDS).toBe(
      "status,disposition,requested_at,cleanup_after,completed_at",
    );
    expect(PRIVACY_VERIFICATION_CLEANUP_EXPORT_FIELDS).not.toMatch(
      /email|auth_user_id|last_error|attempts|actor/i,
    );
  });

  it("queues cleanup through the atomic RPC and reads no plaintext email", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { cleanupId: "cleanup-1" },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { id: "cleanup-1", auth_user_id: "auth-1", attempts: 0 },
      error: null,
    });
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ single })) }));
    const database = {
      rpc,
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient;

    await expect(queuePrivacyVerificationAccountCleanup(database, {
      requestId: "request-1",
      authUserId: "auth-1",
      email: " Person@Example.Test ",
      cleanupAfter: "2026-07-26T12:30:00.000Z",
      now: "2026-07-26T12:00:00.000Z",
    })).resolves.toEqual({
      id: "cleanup-1",
      auth_user_id: "auth-1",
      attempts: 0,
    });
    expect(rpc).toHaveBeenCalledWith(
      "queue_privacy_verification_account_cleanup_atomic",
      expect.objectContaining({ p_email: "person@example.test" }),
    );
    expect(select).toHaveBeenCalledWith("id,auth_user_id,attempts");
  });

  it("derives the invite lookup from Auth and stores only a short cleanup receipt", async () => {
    const updatePayloads: Array<Record<string, unknown>> = [];
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const database = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                email: "person@example.test",
                app_metadata: { privacy_verification_only: true },
              },
            },
            error: null,
          }),
          updateUserById: vi.fn(),
          deleteUser,
        },
      },
      from: vi.fn((table: string) => {
        if (table === "transaction_records") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
            })),
          };
        }
        if (table === "beta_invites") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          };
        }
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          }),
        };
      }),
    } as unknown as SupabaseClient;

    await expect(processPrivacyVerificationAccountCleanup(database, {
      id: "cleanup-1",
      auth_user_id: "auth-1",
      attempts: 0,
    })).resolves.toMatchObject({ ok: true, disposition: "DELETED" });

    expect(deleteUser).toHaveBeenCalledWith("auth-1");
    expect(updatePayloads[0]).toMatchObject({
      status: "COMPLETED",
      disposition: "DELETED",
      attempts: 1,
      last_error: null,
    });
    expect(updatePayloads[0]).not.toHaveProperty("email");
    const completedAt = Date.parse(String(updatePayloads[0]?.completed_at));
    const retentionUntil = Date.parse(String(updatePayloads[0]?.retention_until));
    expect(retentionUntil - completedAt).toBe(7 * 86_400_000);
  });
});
