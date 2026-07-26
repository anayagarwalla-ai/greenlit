import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getOptionalUser: vi.fn(),
  betaAccessAllowedFresh: vi.fn(),
  requireSupabaseAdmin: vi.fn(),
  assertReviewSnapshotIntegrity: vi.fn(),
  reviewSessionAuthorized: vi.fn(),
  receiptSessionAuthorized: vi.fn(),
  packetSingle: vi.fn(),
  download: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/database", () => ({ requireSupabaseAdmin: mocks.requireSupabaseAdmin }));
vi.mock("@/lib/supabase-server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("@/lib/beta-access", () => ({ betaAccessAllowedFresh: mocks.betaAccessAllowedFresh }));
vi.mock("@/lib/recordkeeping", () => ({
  noStoreJsonHeaders: () => ({ "Cache-Control": "no-store" }),
}));
vi.mock("@/lib/review-session", () => ({
  assertReviewSnapshotIntegrity: mocks.assertReviewSnapshotIntegrity,
  reviewSessionAuthorized: mocks.reviewSessionAuthorized,
  receiptSessionAuthorized: mocks.receiptSessionAuthorized,
  reviewSessionCookieName: () => "review-cookie",
  receiptSessionCookieName: () => "receipt-cookie",
}));

import { GET } from "./route";

const packetId = "REVIEW-DOWNLOAD";
const criterionId = "AC-01";
const storagePath = "record/run/ac-01-hash.png";
const snapshot = {
  run: {
    artifacts: [{
      criterionId,
      storagePath,
      mimeType: "image/png",
      sha256: "a".repeat(64),
    }],
  },
};

function packetQuery() {
  return {
    select: () => ({
      eq: () => ({
        single: mocks.packetSingle,
      }),
    }),
  };
}

describe("authorized evidence download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      get: (name: string) => name === "review-cookie" ? { value: "session-token" } : undefined,
    });
    mocks.getOptionalUser.mockResolvedValue(null);
    mocks.reviewSessionAuthorized.mockResolvedValue(true);
    mocks.receiptSessionAuthorized.mockResolvedValue(false);
    mocks.packetSingle.mockResolvedValue({
      data: {
        id: "packet-uuid",
        record_id: "record-uuid",
        snapshot,
        snapshot_sha256: "b".repeat(64),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
        decision: null,
      },
      error: null,
    });
    mocks.download.mockResolvedValue({
      data: new Blob(["private evidence"], { type: "image/png" }),
      error: null,
    });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === "review_packets_v2") return packetQuery();
        throw new Error(`Unexpected table: ${table}`);
      },
      storage: {
        from: () => ({ download: mocks.download }),
      },
    });
  });

  it("streams private evidence as a same-origin attachment", async () => {
    const response = await GET(
      new Request(`https://greenlit.example/api/reviews/${packetId}/evidence/${criterionId}`),
      { params: Promise.resolve({ packetId, criterionId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="AC-01-evidence.png"');
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.download).toHaveBeenCalledWith(storagePath);
    await expect(response.text()).resolves.toBe("private evidence");
  });

  it("fails closed before database access without an authorized session or owner", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });

    const response = await GET(
      new Request(`https://greenlit.example/api/reviews/${packetId}/evidence/${criterionId}`),
      { params: Promise.resolve({ packetId, criterionId }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("cannot download a storage object that is not frozen into the signed snapshot", async () => {
    mocks.packetSingle.mockResolvedValue({
      data: {
        id: "packet-uuid",
        record_id: "record-uuid",
        snapshot: { run: { artifacts: [] } },
        snapshot_sha256: "b".repeat(64),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
        decision: null,
      },
      error: null,
    });

    const response = await GET(
      new Request(`https://greenlit.example/api/reviews/${packetId}/evidence/${criterionId}`),
      { params: Promise.resolve({ packetId, criterionId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
