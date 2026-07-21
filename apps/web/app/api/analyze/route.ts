import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isGroundedQuote, normalizeSourceText } from "@/lib/analysis";
import { buildFallbackCriteria } from "@/lib/fallback-analysis";
import { getOptionalUser } from "@/lib/supabase-server";
import { betaAccessAllowed } from "@/lib/beta-access";
import { consumeRateLimit, positiveIntegerSetting, rateLimitedResponse } from "@/lib/rate-limit";
import { logOperationalEvent } from "@/lib/operations";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_SOURCE_LENGTH = 45_000;
const MAX_FILE_BYTES = 3_000_000;
const MAX_CRITERIA = 8;
const GEMINI_TIMEOUT_MS = 8_000;
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_UNPAID_RESTRICTED_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH", "GB",
]);

const requestSchema = z.object({
  text: z.string().min(80).max(MAX_SOURCE_LENGTH),
  syntheticDataAttested: z.literal(true),
  unpaidAiDisclosureAccepted: z.literal(true),
  adultBusinessUseAttested: z.literal(true),
  sourceName: z.string().min(1).max(160).optional(),
});

const extractedCriterionSchema = z.object({
  title: z.string().min(3).max(160),
  sourceQuote: z.string().min(3).max(1000),
  supported: z.boolean(),
  checkType: z.enum(["element_state", "link_destination", "form_submission", "viewport_layout", "axe_scan", "manual"]),
  rationale: z.string().min(3).max(500),
});

const responseSchema = z.object({ criteria: z.array(extractedCriterionSchema).min(1).max(MAX_CRITERIA) });

class InputError extends Error {
  constructor(message: string, readonly code: string, readonly status = 422) {
    super(message);
  }
}

function isSupportedTextFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
}

async function extractFileText(file: File) {
  if (file.size > MAX_FILE_BYTES) throw new InputError("Keep uploads under 3 MB.", "FILE_TOO_LARGE", 413);
  if (file.size === 0) throw new InputError("The selected file is empty.", "EMPTY_FILE");

  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  if (isPdf) {
    if (!("DOMMatrix" in globalThis)) await import("pdf-parse/worker");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const result = await parser.getText();
      const text = normalizeSourceText(result.text);
      if (!text) throw new InputError("No selectable text was found in this PDF. Paste the SOW text instead.", "EMPTY_PDF");
      return text;
    } finally {
      await parser.destroy();
    }
  }

  if (!isSupportedTextFile(file)) {
    throw new InputError("Upload a PDF, TXT, or Markdown SOW.", "UNSUPPORTED_FILE", 415);
  }
  return normalizeSourceText(await file.text());
}

async function readInput(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    if (form.get("syntheticDataAttested") !== "true") {
      throw new InputError("Confirm the SOW is synthetic or non-confidential before analysis.", "ATTESTATION_REQUIRED");
    }
    if (form.get("unpaidAiDisclosureAccepted") !== "true" || form.get("adultBusinessUseAttested") !== "true") {
      throw new InputError("Accept the Gemini free-tier data notice and confirm adult business use before analysis.", "AI_NOTICE_REQUIRED");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new InputError("Choose a SOW file to analyze.", "FILE_REQUIRED");
    const text = await extractFileText(file);
    return requestSchema.parse({ text, sourceName: file.name, syntheticDataAttested: true, unpaidAiDisclosureAccepted: true, adultBusinessUseAttested: true });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body && typeof body === "object" ? { ...body, text: normalizeSourceText(String(body.text ?? "")) } : body);
  if (!parsed.success) throw new InputError("Paste at least 80 characters of SOW text and confirm it is synthetic or non-confidential.", "INVALID_SOURCE");
  return parsed.data;
}

type AnalysisInput = z.infer<typeof requestSchema>;

function analysisResponse({
  input,
  criteria,
  model,
  analysisMode,
  notice,
  startedAt,
  providerStartedAt,
}: {
  input: AnalysisInput;
  criteria: ReturnType<typeof buildFallbackCriteria>;
  model: string;
  analysisMode: "gemini" | "fallback";
  notice?: string;
  startedAt: number;
  providerStartedAt: number | undefined;
}) {
  const finishedAt = performance.now();
  const totalDuration = Math.round(finishedAt - startedAt);
  const providerTiming = providerStartedAt === undefined ? "" : `, gemini;dur=${Math.round(finishedAt - providerStartedAt)}`;
  return NextResponse.json({
    sourceName: input.sourceName ?? "Pasted SOW",
    sourceText: input.text,
    criteria,
    requiresHumanConfirmation: true,
    model,
    analysisMode,
    notice,
    durationMs: totalDuration,
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `total;dur=${totalDuration}${providerTiming}`,
      "X-Analysis-Mode": analysisMode,
    },
  });
}

function fallbackResponse(input: AnalysisInput, reason: "unavailable" | "not_configured" | "region_restricted", startedAt: number, providerStartedAt?: number) {
  const criteria = buildFallbackCriteria(input.text);
  if (criteria.length === 0) {
    return NextResponse.json({
      error: "No measurable promises were found. Paste the acceptance criteria or deliverables section and try again.",
      code: "NO_CRITERIA_FOUND",
    }, { status: 422 });
  }

  return analysisResponse({
    input,
    criteria,
    model: "MilestoneProof fast fallback",
    analysisMode: "fallback",
    notice: reason === "unavailable"
      ? "Gemini was unavailable or did not respond within 8 seconds, so MilestoneProof generated this source-grounded draft locally instead of making you wait. Review each item before continuing."
      : reason === "region_restricted"
        ? "Gemini's unpaid API tier is not offered for this region. MilestoneProof kept the source local and generated a source-grounded draft without sending it to Google."
        : "Gemini is not configured, so MilestoneProof generated this source-grounded draft locally. Review each item before continuing.",
    startedAt,
    providerStartedAt,
  });
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Sign in with your business email to analyze a SOW. The guided demo remains available without an account.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
  if (!betaAccessAllowed(user)) return NextResponse.json({ error: "This email is not on the closed-beta invite list yet.", code: "BETA_INVITE_REQUIRED" }, { status: 403 });
  let input: AnalysisInput;
  try {
    input = await readInput(request);
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "The extracted SOW text must be between 80 and 45,000 characters.", code: "INVALID_SOURCE" }, { status: 422 });
    return NextResponse.json({ error: "The SOW could not be read. Try pasting the text instead.", code: "SOURCE_READ_FAILED" }, { status: 422 });
  }
  // Quota is only consumed once the request body is fully read and validated
  // above, so a malformed or oversized request never costs the account or
  // the shared daily capacity pool.
  const quota = await consumeRateLimit(request, "sow-analysis-hour", 10, 3_600, user.id, { failClosed: true });
  if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
  const globalLimit = positiveIntegerSetting(process.env.BETA_DAILY_ANALYSIS_LIMIT, 100);
  const capacity = await consumeRateLimit(request, "sow-analysis-capacity-day", globalLimit, 86_400, "milestoneproof-global-analysis-capacity", { failClosed: true });
  if (!capacity.allowed) return NextResponse.json({ error: "Today’s closed-beta AI capacity has been used. The guided demo and local review flow remain available.", code: "BETA_CAPACITY_REACHED" }, { status: 429, headers: { "Retry-After": String(capacity.retryAfterSeconds), "Cache-Control": "no-store" } });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackResponse(input, "not_configured", startedAt);
  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  const paidService = process.env.NEXT_PUBLIC_GEMINI_SERVICE_TIER === "paid";
  if (!paidService && country && GEMINI_UNPAID_RESTRICTED_COUNTRIES.has(country)) return fallbackResponse(input, "region_restricted", startedAt);

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const providerStartedAt = performance.now();
  try {
    const result = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [{
          text: `You are helping an agency turn a statement of work into an auditable acceptance checklist.

Extract only atomic, objectively verifiable promises from the source. For every item:
- sourceQuote must copy the smallest complete supporting sentence or clause verbatim from SOURCE. Do not paraphrase the quote.
- title should state one measurable outcome in plain language.
- supported is true only when a safe browser check can verify the outcome without credentials, payments, external side effects, or arbitrary code.
- checkType must be manual when the promise is subjective, a business outcome, requires authentication/payment/email, or cannot be proven safely in a browser.
- rationale should briefly explain what evidence would prove the promise or why human review is required.

Never invent a URL, path, selector, action, number, or requirement. Return no criterion without an exact source quote.
Return the 3 to 8 highest-value criteria, or fewer only when the source contains fewer measurable promises. Keep every field concise.

SOURCE:
${input.text}`,
        }],
      }],
      config: {
        abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        temperature: 0.1,
        maxOutputTokens: 2_200,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["criteria"],
          properties: {
            criteria: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["title", "sourceQuote", "supported", "checkType", "rationale"],
                properties: {
                  title: { type: Type.STRING },
                  sourceQuote: { type: Type.STRING },
                  supported: { type: Type.BOOLEAN },
                  checkType: { type: Type.STRING, enum: ["element_state", "link_destination", "form_submission", "viewport_layout", "axe_scan", "manual"] },
                  rationale: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });
    const validated = responseSchema.parse(JSON.parse(result.text ?? "{}"));
    const criteria = validated.criteria
      .map((criterion) => ({
        ...criterion,
        supported: criterion.supported && criterion.checkType !== "manual",
        grounded: isGroundedQuote(input.text, criterion.sourceQuote),
      }))
      .filter((criterion) => criterion.grounded);
    if (criteria.length === 0) throw new Error("Gemini returned no source-grounded criteria");

    return analysisResponse({
      input,
      criteria,
      model,
      analysisMode: "gemini",
      startedAt,
      providerStartedAt,
    });
  } catch (error) {
    console.error("Gemini analysis failed", error instanceof Error ? error.message : "unknown error");
    await logOperationalEvent({ severity: "WARN", service: "web", eventType: "GEMINI_ANALYSIS_FALLBACK", details: { model, reason: error instanceof Error ? error.message.slice(0, 300) : "unknown" } });
    return fallbackResponse(input, "unavailable", startedAt, providerStartedAt);
  }
}
