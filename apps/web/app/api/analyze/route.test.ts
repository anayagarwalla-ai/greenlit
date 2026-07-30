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
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
  Type: {
    OBJECT: "object",
    ARRAY: "array",
    STRING: "string",
    BOOLEAN: "boolean",
  },
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
  LOCAL_FALLBACK_MODEL: "Greenlit local source parser",
  localFallbackNotice: (reason: string) => reason === "consent_record_unavailable"
    ? "Greenlit could not retain consent, so it did not send this SOW to Google. Its local source parser created this source-grounded draft."
    : reason === "unavailable"
      ? "Gemini may already have received the SOW. The local source parser created a source-grounded draft."
      : "Greenlit did not send this SOW to Google. Its local source parser created a source-grounded draft.",
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

function request(overrides: Record<string, unknown> = {}) {
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
      ...overrides,
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
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        criteria: [{
          title: "Get started is visible",
          sourceQuote: "The launch page must display a visible Get started button on the home page.",
          supported: true,
          checkType: "element_state",
          rationale: "Inspect the rendered control.",
        }],
      }),
    });
    mocks.requireSupabaseAdmin.mockReturnValue({
      from: (table: string) => {
        if (table !== "analysis_consent_events") throw new Error(`Unexpected table: ${table}`);
        return { insert: mocks.consentInsert };
      },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses the source-grounded local fallback without requiring storage when Gemini is not configured", async () => {
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
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.consentInsert).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.logProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "ANALYSIS_COMPLETED",
      ownerUserId: null,
      properties: expect.objectContaining({ mode: "fallback", reason: "not_configured" }),
    }));
  });

  it("still requires explicit data and business-use confirmations for local parsing", async () => {
    const response = await POST(request({ aiDisclosureAccepted: false }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_SOURCE" });
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.logProductEvent).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("records pseudonymous consent before sending an unsigned attested SOW to Gemini", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-mode")).toBe("gemini");
    await expect(response.json()).resolves.toMatchObject({
      sourceName: "Public test SOW",
      sourceText: source,
      analysisMode: "gemini",
      requiresHumanConfirmation: true,
    });
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
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.consentInsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.generateContent.mock.invocationCallOrder[0]!);
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

  it("keeps the source out of Gemini and recovers locally when consent cannot be retained", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    mocks.requireSupabaseAdmin.mockImplementation(() => {
      throw new Error("Durable record storage is not configured.");
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-analysis-mode")).toBe("fallback");
    await expect(response.json()).resolves.toMatchObject({
      analysisMode: "fallback",
      model: "Greenlit local source parser",
      notice: expect.stringContaining("did not send this SOW to Google"),
    });
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.consentInsert).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.logOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "ANALYSIS_CONSENT_RECORD_FAILED",
      details: expect.objectContaining({ recovery: "local_fallback" }),
    }));
    expect(mocks.logProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      properties: expect.objectContaining({ reason: "consent_record_unavailable" }),
    }));
  });

  it("uses the local fallback in unpaid-tier restricted regions without retaining provider consent", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key");
    const restrictedRequest = request();
    restrictedRequest.headers.set("x-vercel-ip-country", "GB");

    const response = await POST(restrictedRequest);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      analysisMode: "fallback",
      notice: expect.stringContaining("did not send this SOW to Google"),
    });
    expect(mocks.requireSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.consentInsert).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
});
