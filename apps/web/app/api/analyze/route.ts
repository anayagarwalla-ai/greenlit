import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { isGroundedQuote, normalizeSourceText } from "@/lib/analysis";

export const runtime = "nodejs";

const MAX_SOURCE_LENGTH = 45_000;
const MAX_FILE_BYTES = 3_000_000;

const requestSchema = z.object({
  text: z.string().min(80).max(MAX_SOURCE_LENGTH),
  syntheticDataAttested: z.literal(true),
  sourceName: z.string().min(1).max(160).optional(),
});

const extractedCriterionSchema = z.object({
  title: z.string().min(3).max(160),
  sourceQuote: z.string().min(3).max(1000),
  supported: z.boolean(),
  checkType: z.enum(["element_state", "link_destination", "form_submission", "viewport_layout", "axe_scan", "manual"]),
  rationale: z.string().min(3).max(500),
});

const responseSchema = z.object({ criteria: z.array(extractedCriterionSchema).min(1).max(30) });

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
    const file = form.get("file");
    if (!(file instanceof File)) throw new InputError("Choose a SOW file to analyze.", "FILE_REQUIRED");
    const text = await extractFileText(file);
    return requestSchema.parse({ text, sourceName: file.name, syntheticDataAttested: true });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body && typeof body === "object" ? { ...body, text: normalizeSourceText(String(body.text ?? "")) } : body);
  if (!parsed.success) throw new InputError("Paste at least 80 characters of SOW text and confirm it is synthetic or non-confidential.", "INVALID_SOURCE");
  return parsed.data;
}

export async function POST(request: Request) {
  let input: z.infer<typeof requestSchema>;
  try {
    input = await readInput(request);
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "The extracted SOW text must be between 80 and 45,000 characters.", code: "INVALID_SOURCE" }, { status: 422 });
    return NextResponse.json({ error: "The SOW could not be read. Try pasting the text instead.", code: "SOURCE_READ_FAILED" }, { status: 422 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI analysis is not configured. Use the guided demo while the workspace owner adds Gemini.", code: "AI_NOT_CONFIGURED" }, { status: 503 });

  const ai = new GoogleGenAI({ apiKey });
  try {
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
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

SOURCE:
${input.text}`,
        }],
      }],
      config: {
        temperature: 0.1,
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
    const criteria = validated.criteria.map((criterion) => ({
      ...criterion,
      supported: criterion.supported && criterion.checkType !== "manual",
      grounded: isGroundedQuote(input.text, criterion.sourceQuote),
    }));
    return NextResponse.json({
      sourceName: input.sourceName ?? "Pasted SOW",
      sourceText: input.text,
      criteria,
      requiresHumanConfirmation: true,
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    });
  } catch (error) {
    console.error("Gemini analysis failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Gemini could not analyze this document. Try again or use the guided demo.", code: "ANALYSIS_FAILED" }, { status: 502 });
  }
}
