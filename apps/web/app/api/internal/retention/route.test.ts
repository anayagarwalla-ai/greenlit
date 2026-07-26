import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/database", () => ({ requireSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/recordkeeping", () => ({ noStoreJsonHeaders: () => ({}) }));
vi.mock("@/lib/privacy-verification-cleanup", () => ({
  PRIVACY_ACCOUNT_DELETION_RECEIPT_DAYS: 30,
  processPrivacyVerificationAccountCleanup: vi.fn(),
  retentionRetryAt: vi.fn(),
}));

import {
  evidenceJobIdFromStoragePath,
  excludeRunningEvidenceAdoptions,
} from "./route";

const recordId = "11111111-1111-4111-8111-111111111111";
const runningJobId = "22222222-2222-4222-8222-222222222222";
const completedJobId = "33333333-3333-4333-8333-333333333333";

describe("orphaned evidence adoption guard", () => {
  it("parses only the immutable record/job evidence path shape", () => {
    expect(evidenceJobIdFromStoragePath(
      `${recordId}/${runningJobId}/criterion-screenshot.png`,
    )).toBe(runningJobId);
    expect(evidenceJobIdFromStoragePath("legacy/unstructured/path.png")).toBeNull();
    expect(evidenceJobIdFromStoragePath(
      `${recordId}/${runningJobId}/nested/path.png`,
    )).toBeNull();
  });

  it("excludes RUNNING job paths immediately before orphan removal", async () => {
    const runningPath = `${recordId}/${runningJobId}/running.png`;
    const completedPath = `${recordId}/${completedJobId}/completed.png`;
    const legacyPath = "legacy-object.png";
    const eq = vi.fn().mockResolvedValue({
      data: [{ id: runningJobId }],
      error: null,
    });
    const inFilter = vi.fn(() => ({ eq }));
    const select = vi.fn(() => ({ in: inFilter }));
    const database = { from: vi.fn(() => ({ select })) };

    await expect(excludeRunningEvidenceAdoptions(
      database as never,
      [runningPath, completedPath, legacyPath],
    )).resolves.toEqual([completedPath, legacyPath]);

    expect(database.from).toHaveBeenCalledWith("verification_jobs_v2");
    expect(inFilter).toHaveBeenCalledWith(
      "id",
      [runningJobId, completedJobId],
    );
    expect(eq).toHaveBeenCalledWith("status", "RUNNING");
  });

  it("fails closed when active-job state cannot be checked", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "synthetic read failure" },
    });
    const database = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => ({ eq })),
        })),
      })),
    };

    await expect(excludeRunningEvidenceAdoptions(
      database as never,
      [`${recordId}/${runningJobId}/running.png`],
    )).rejects.toThrow("Evidence adoption guard failed");
  });
});
