import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  betaAccessAllowedFresh: vi.fn(),
  consumeRateLimit: vi.fn(),
  requireSupabaseAdmin: vi.fn(),
  requestActorHash: vi.fn(),
  logOperationalEvent: vi.fn(),
  logProductEvent: vi.fn(),
  consentInsert: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({ getOptionalUser: mocks.getOptionalUser }));
vi.mock("@/lib/beta-access", () => ({ betaAccessAllowedFresh: mocks.betaAccessAllowedFresh }));
vi.mock("@/lib/database", () => ({ requireSupabaseAdmin: mocks.requireSupabaseAdmin }));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  positiveIntegerSetting: (_value: string | undefined, fallback: number) => fallback,
  rateLimitedResponse: () => Response.json({ error: "Rate limited" }, { status: 429 }),
}));
vi.mock("@/lib/operations", () => ({
  logOperationalEvent: mocks.logOperationalEvent,
  logProductEvent: mocks.logProductEvent,
}));
vi.mock("@/lib/recordkeeping", () => ({
  RECORD_NOTICE_VERSION: "test-record-notice",
  requestActorHash: mocks.requestActorHash,
}));
vi.mock("@/lib/analysis", () => ({
  isGroundedQuote: () => true,
  normalizeSourceText: (value: string) => value.trim(),
}));
vi.mock("@/lib/fallback-analysis", () => ({
  buildFallbackCriteria: (text: string) => [{
    title: "Get started is visible",
    sourceQuote: text.split(".")[0] + ".",
    supported: true,
    checkType: "element_state",
    rationale: "Inspect the rendered control.",
    grounded: true,
  }],
}));
vi.mock("@/lib/gemini-service", () => ({
  geminiServiceConfiguration: () => ({
    paidService: false,
    providerNoticeVersion: "gemini-unpaid-test",
  }),
}));
vi.mock("@/lib/source-extraction", () => {
  class SourceInputError extends Error {
    code: string;
    status: number;

    constructor(message: string, code: string, status = 422) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    SourceInputError,
    extractSourceFileText: vi.fn(),
  };
});
vi.mock("@/lib/request-security", () => {
  class RequestSizeError extends Error {
    maxBytes = 64_000;
  }
  return {
    RequestSizeError,
    readLimitedFormData: (request: Request) => request.formData(),
    readLimitedJson: (request: Request) => request.json(),
    requestTooLargeResponse: () => Response.json({ error: "Request too large" }, { status: 413 }),
  };
});

import { POST } from "./route";

const source = "The launch page must display a visible Get started button on the home page. The button must open the /contact page when activated.";

function request() {
  return new Request("https://greenlit.example/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "192.0.2.10",
    },
    body: JSON.stringify({
      text: source,
      sourceName: "Public test SOW",
      sourceDataAttested: true,
      aiDisclosureAccepted: true,
      adultBusinessUseAttested: true,
    }),
  });
}

describe("public SOW analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "");
    mocks.getOptionalUser.mockResolvedValue(null);
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 3_600 });
    mocks.requestActorHash.mockReturnValue("anonymous-actor-hash");
    mocks.consentInsert.mockResolvedValue({ error: null });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table !== "analysis_consent_events") throw new Error(`Unexpected table: ${table}`);
        return { insert: mocks.consentInsert };
      },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("accepts an unsigned attested SOW and records pseudonymous consent", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-mode")).toBe("fallback");
    await expect(response.json()).resolves.toMatchObject({
      sourceName: "Public test SOW",
      sourceText: source,
      analysisMode: "fallback",
      requiresHumanConfirmation: true,
    });
    expect(mocks.betaAccessAllowedFresh).not.toHaveBeenCalled();
    expect(mocks.consentInsert).toHaveBeenCalledWith(expect.objectContaining({
      owner_user_id: null,
      actor_hash: "anonymous-actor-hash",
      source_mode: "PASTE",
      accepted_terms: true,
      accepted_data_notice: true,
    }));
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.any(Request),
      "sow-analysis-intake-hour",
      8,
      3_600,
      null,
      { failClosed: true },
    );
    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(Request),
      "sow-analysis-hour",
      3,
      3_600,
      null,
      { failClosed: true },
    );
    expect(mocks.logProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "ANALYSIS_COMPLETED",
      ownerUserId: null,
    }));
  });

  it("still rejects a signed-in account that is no longer invited", async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: "user-1", email: "removed@example.test" });
    mocks.betaAccessAllowedFresh.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "BETA_INVITE_REQUIRED" });
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled();
    expect(mocks.consentInsert).not.toHaveBeenCalled();
  });

  it("fails closed before analysis when anonymous consent cannot be retained", async () => {
    mocks.consentInsert.mockResolvedValue({ error: { message: "database unavailable" } });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "CONSENT_RECORD_FAILED" });
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.logProductEvent).not.toHaveBeenCalled();
  });
});
