import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRunnerRequest: vi.fn(),
  requireSupabaseAdmin: vi.fn(),
  rpc: vi.fn(),
  single: vi.fn(),
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
  return new Request(`https://greenlit.example/api/internal/jobs/${jobId}/lease`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attempt: 1, leaseId }),
  });
}

describe("runner lease route", () => {
  beforeEach(() => {
    mocks.verifyRunnerRequest.mockReset().mockResolvedValue(true);
    mocks.single.mockReset();
    mocks.rpc.mockReset().mockReturnValue({ single: mocks.single });
    mocks.requireSupabaseAdmin.mockReset().mockReturnValue({ rpc: mocks.rpc });
    mocks.getOperationalControl.mockReset().mockResolvedValue({
      feature: "RUNS",
      paused: false,
      reason: "",
      source: "database",
    });
    vi.stubEnv("RUNNER_HMAC_SECRET", "test-runner-secret");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("blocks an environment pause before the database lease call", async () => {
    mocks.getOperationalControl.mockResolvedValue({
      feature: "RUNS",
      paused: true,
      reason: "Emergency maintenance is in progress.",
      source: "environment",
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(423);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNS_PAUSED",
      retryable: true,
    });
  });

  it("returns a stable retryable pause response when the database guard wins the race", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "Operational capability RUNS is paused",
        details: "RUNS_PAUSED",
      },
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(423);
    expect(response.headers.get("retry-after")).toBe("300");
    await expect(response.json()).resolves.toEqual({
      error: "Verification runs are temporarily paused by the operator safety control.",
      code: "RUNS_PAUSED",
      retryable: true,
      retryAfterSeconds: 300,
    });
  });

  it("returns the stable pause response when the control lookup throws", async () => {
    mocks.getOperationalControl.mockRejectedValue(new Error("control lookup unavailable"));

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(423);
    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNS_PAUSED",
      retryable: true,
    });
  });

  it("returns the stable pause response when the database guard error is thrown", async () => {
    mocks.single.mockRejectedValue({
      code: "P0001",
      message: "Operational capability RUNS is paused",
      details: "RUNS_PAUSED",
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNS_PAUSED",
      retryable: true,
    });
  });

  it("acknowledges a duplicate worker lease race as a terminal conflict", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "Job cannot be leased from RUNNING",
        details: null,
      },
    });

    const response = await POST(request(), { params: Promise.resolve({ jobId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "LEASE_ALREADY_RESOLVED",
      retryable: false,
    });
  });
});
