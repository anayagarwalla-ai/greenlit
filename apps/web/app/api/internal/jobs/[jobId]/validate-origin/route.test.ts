import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRunnerRequest: vi.fn(),
  requireSupabaseAdmin: vi.fn(),
  getOperationalControl: vi.fn(),
}));

vi.mock("@/lib/hmac", () => ({ verifyRunnerRequest: mocks.verifyRunnerRequest }));
vi.mock("@/lib/database", () => ({ requireSupabaseAdmin: mocks.requireSupabaseAdmin }));
vi.mock("@/lib/operational-controls", () => ({
  getOperationalControl: mocks.getOperationalControl,
  internalRunsPauseResponse: (retryable: boolean) => Response.json({
    error: "Verification runs are temporarily paused by the operator safety control.",
    code: "RUNS_PAUSED",
    retryable,
    ...(retryable ? { retryAfterSeconds: 300 } : {}),
  }, { status: 423, headers: retryable ? { "Retry-After": "300" } : {} }),
}));
vi.mock("@/lib/security", () => ({
  assertSafeResolvedAddresses: vi.fn(),
  validateStagingUrl: vi.fn(),
}));
vi.mock("@/lib/recordkeeping", () => ({ noStoreJsonHeaders: () => ({ "Cache-Control": "no-store" }) }));
vi.mock("@/lib/request-security", () => {
  class RequestSizeError extends Error {
    maxBytes = 8_000;
  }
  return {
    RequestSizeError,
    readLimitedBody: (request: Request) => request.text(),
    requestTooLargeResponse: () => Response.json({ error: "Request too large" }, { status: 413 }),
  };
});

import { POST } from "./route";

const jobId = "1c42f33d-2b36-47f9-b919-52826f34f3ca";
const leaseId = "d69956a0-70b6-4acd-9898-1b398fe38d8d";

function request() {
  return new Request(`https://greenlit.example/api/internal/jobs/${jobId}/validate-origin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leaseId }),
  });
}

describe("runner origin-validation pause boundary", () => {
  beforeEach(() => {
    mocks.verifyRunnerRequest.mockReset().mockResolvedValue(true);
    mocks.requireSupabaseAdmin.mockReset();
    mocks.getOperationalControl.mockReset();
    vi.stubEnv("RUNNER_HMAC_SECRET", "test-runner-secret");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["environment", "database"] as const)("stops an active job for a %s RUNS pause before origin or job access", async (source) => {
    mocks.getOperationalControl.mockResolvedValue({
      feature: "RUNS",
      paused: true,
      reason: "Verification is paused safely.",
      source,
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(423);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Verification runs are temporarily paused by the operator safety control.",
      code: "RUNS_PAUSED",
      retryable: false,
    });
  });

  it("fails closed with the same active-job contract when the control lookup throws", async () => {
    mocks.getOperationalControl.mockRejectedValue(new Error("control lookup unavailable"));

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(423);
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNS_PAUSED",
      retryable: false,
    });
  });
});
