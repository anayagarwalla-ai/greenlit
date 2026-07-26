import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("./database", () => ({
  getSupabaseAdmin: databaseMock.getSupabaseAdmin,
}));

import { getOperationalControl, internalRunsPauseResponse, operationalPauseResponse } from "./operational-controls";

describe("operational safety controls", () => {
  beforeEach(() => {
    databaseMock.getSupabaseAdmin.mockReset();
    databaseMock.maybeSingle.mockReset();
    databaseMock.getSupabaseAdmin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: databaseMock.maybeSingle }),
        }),
      }),
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("lets an environment pause override the database", async () => {
    const control = await getOperationalControl("RUNS", {
      BETA_PAUSE_RUNS: "true",
      BETA_PAUSE_REASON: "Emergency maintenance is in progress.",
    });
    expect(control).toMatchObject({
      paused: true,
      reason: "Emergency maintenance is in progress.",
      source: "environment",
    });
    expect(databaseMock.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("fails closed in production when durable controls are unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    databaseMock.getSupabaseAdmin.mockReturnValue(null);
    await expect(getOperationalControl("REVIEWS", {})).resolves.toMatchObject({
      paused: true,
      source: "unavailable",
    });
  });

  it("fails closed in production when the control lookup errors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    databaseMock.maybeSingle.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(getOperationalControl("INVOICES", {})).resolves.toMatchObject({
      paused: true,
      source: "unavailable",
    });
  });

  it("returns database state and a retryable 503 pause response", async () => {
    databaseMock.maybeSingle.mockResolvedValue({
      data: {
        paused: true,
        reason: "Invoice delivery is paused during provider maintenance.",
        updated_by: "operator@example.test",
        updated_at: "2026-07-26T00:00:00.000Z",
      },
      error: null,
    });
    const control = await getOperationalControl("INVOICES", {});
    expect(control).toMatchObject({ paused: true, source: "database" });
    const response = operationalPauseResponse(control);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    await expect(response.json()).resolves.toMatchObject({ code: "INVOICES_PAUSED" });
  });

  it("uses one stable internal RUNS pause contract for queued and active jobs", async () => {
    const queued = internalRunsPauseResponse(true);
    expect(queued.status).toBe(423);
    expect(queued.headers.get("retry-after")).toBe("300");
    await expect(queued.json()).resolves.toEqual({
      error: "Verification runs are temporarily paused by the operator safety control.",
      code: "RUNS_PAUSED",
      retryable: true,
      retryAfterSeconds: 300,
    });

    const active = internalRunsPauseResponse(false);
    expect(active.status).toBe(423);
    expect(active.headers.get("retry-after")).toBeNull();
    await expect(active.json()).resolves.toMatchObject({
      code: "RUNS_PAUSED",
      retryable: false,
    });
  });
});
