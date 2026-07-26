import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseAdmin: vi.fn(),
  getSupabaseServerClient: vi.fn(),
  queueCleanup: vi.fn(),
  processCleanup: vi.fn(),
  logOperationalEvent: vi.fn(),
}));

vi.mock("@/lib/database", () => ({
  requireSupabaseAdmin: mocks.requireSupabaseAdmin,
}));
vi.mock("@/lib/recordkeeping", () => ({
  sha256: (value: string) => `hash:${value}`,
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServerClient: mocks.getSupabaseServerClient,
}));
vi.mock("@/lib/privacy-verification-cleanup", () => ({
  queuePrivacyVerificationAccountCleanup: mocks.queueCleanup,
  processPrivacyVerificationAccountCleanup: mocks.processCleanup,
}));
vi.mock("@/lib/operations", () => ({
  logOperationalEvent: mocks.logOperationalEvent,
}));

import { GET } from "./route";

describe("privacy verification callback cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueCleanup.mockResolvedValue({
      id: "cleanup-1",
      auth_user_id: "auth-1",
      attempts: 0,
    });
    mocks.processCleanup.mockResolvedValue({
      ok: true,
      disposition: "DELETED",
    });
    mocks.logOperationalEvent.mockResolvedValue(undefined);
  });

  it("queues and processes the temporary Auth account when verification persistence fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.getSupabaseServerClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "auth-1",
              email: "person@example.test",
              app_metadata: { privacy_verification_only: true },
            },
          },
        }),
        signOut,
      },
    });
    const database = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "synthetic database failure" },
      }),
      auth: { admin: { deleteUser: vi.fn() } },
    };
    mocks.requireSupabaseAdmin.mockReturnValue(database);

    const response = await GET(new Request(
      "https://greenlit.example/privacy-request/verify?code=code-1&requestId=PRIV-1&state=state-1",
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://greenlit.example/privacy-request?verification=invalid",
    );
    expect(mocks.queueCleanup).toHaveBeenCalledWith(database, expect.objectContaining({
      requestId: null,
      authUserId: "auth-1",
      email: "person@example.test",
    }));
    expect(mocks.processCleanup).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ id: "cleanup-1" }),
    );
    expect(signOut).toHaveBeenCalled();
  });
});
