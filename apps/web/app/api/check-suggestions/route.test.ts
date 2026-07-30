import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  betaAccessAllowedFresh: vi.fn(),
  verifyOriginProof: vi.fn(),
  consumeRateLimit: vi.fn(),
  getOperationalControl: vi.fn(),
  discoverRunnerBuild: vi.fn(),
  mappingIntentTerms: vi.fn(),
  suggestMappings: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("@/lib/beta-access", () => ({ betaAccessAllowedFresh: mocks.betaAccessAllowedFresh }));
vi.mock("@/lib/origin-proof", () => ({ verifyOriginProof: mocks.verifyOriginProof }));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/operational-controls", () => ({
  getOperationalControl: mocks.getOperationalControl,
  operationalPauseResponse: vi.fn(),
}));
vi.mock("@/lib/runner-discovery", () => ({ discoverRunnerBuild: mocks.discoverRunnerBuild }));
vi.mock("@/lib/mapping-suggestions", () => ({
  mappingIntentTerms: mocks.mappingIntentTerms,
  suggestMappings: mocks.suggestMappings,
}));
vi.mock("@/lib/recordkeeping", () => ({ noStoreJsonHeaders: () => ({ "cache-control": "no-store" }) }));
vi.mock("@/lib/request-security", () => ({
  readLimitedJsonResult: async (request: Request) => ({ ok: true, body: await request.json() }),
}));
vi.mock("@/lib/security", () => ({
  validateStagingUrl: (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? { ok: true, url } : { ok: false, reason: "HTTPS required" };
    } catch {
      return { ok: false, reason: "Invalid URL" };
    }
  },
}));

import { POST } from "./route";

const requestBody = {
  target: "https://staging.example",
  startPath: "/previews/launch",
  originReceipt: "signed-origin-receipt-value",
  criteria: [{
    id: "AC-01",
    title: "Search button is visible",
    sourceQuote: "The Search button must be visible.",
    supported: true,
    checkType: "element_state",
    rationale: "Observe the named control.",
    grounded: true,
  }],
};

function request() {
  return new Request("http://localhost/api/check-suggestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

describe("POST /api/check-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUNNER_URL = "https://runner.example";
    process.env.RUNNER_HMAC_SECRET = "runner-secret";
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1", email: "owner@example.com" });
    mocks.betaAccessAllowedFresh.mockResolvedValue(true);
    mocks.verifyOriginProof.mockReturnValue(true);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true });
    mocks.getOperationalControl.mockResolvedValue({ paused: false });
    mocks.discoverRunnerBuild.mockResolvedValue({
      pages: ["/previews/launch"],
      candidates: [{
        id: "p1-button-1",
        path: "/previews/launch",
        role: "button",
        name: "Search",
        ref: "button:Search",
        visible: true,
        enabled: true,
        matchCount: 1,
        unique: true,
      }],
      truncated: false,
    });
    mocks.mappingIntentTerms.mockReturnValue(["search", "button"]);
    mocks.suggestMappings.mockReturnValue([{
      criterionId: "AC-01",
      status: "suggested",
      choices: [],
      confidence: 1,
      draft: { path: "/previews/launch", elementRef: "button:Search" },
      explanation: "Matched the observed Search button.",
    }]);
  });

  afterEach(() => {
    delete process.env.RUNNER_URL;
    delete process.env.RUNNER_HMAC_SECRET;
  });

  it("requires an authenticated beta account before scanning", async () => {
    mocks.getOptionalUser.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.discoverRunnerBuild).not.toHaveBeenCalled();
  });

  it("preserves the supplied preview path and returns grounded suggestions", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.discoverRunnerBuild).toHaveBeenCalledWith(
      "https://runner.example",
      "runner-secret",
      expect.objectContaining({
        origin: "https://staging.example",
        startPath: "/previews/launch",
        intentTerms: ["search", "button"],
        originReceipt: "signed-origin-receipt-value",
        userId: "user-1",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      pagesScanned: ["/previews/launch"],
      suggestions: [{
        criterionId: "AC-01",
        status: "suggested",
        draft: { path: "/previews/launch", elementRef: "button:Search" },
      }],
    });
  });

  it("rejects an expired or mismatched origin proof before contacting the runner", async () => {
    mocks.verifyOriginProof.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.discoverRunnerBuild).not.toHaveBeenCalled();
  });
});
