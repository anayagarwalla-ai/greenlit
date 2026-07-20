import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().min(80).max(45_000),
  syntheticDataAttested: z.literal(true),
});

const extractedCriterionSchema = z.object({
  title: z.string().min(3).max(160),
  sourceQuote: z.string().min(3).max(1000),
  supported: z.boolean(),
  checkType: z.enum(["element_state", "link_destination", "form_submission", "viewport_layout", "axe_scan", "manual"]),
  rationale: z.string().min(3).max(500),
});

const responseSchema = z.object({ criteria: z.array(extractedCriterionSchema).min(1).max(30) });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide selected SOW text and confirm it is synthetic or non-confidential." }, { status: 422 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not configured.", code: "AI_NOT_CONFIGURED" }, { status: 503 });

  const ai = new GoogleGenAI({ apiKey });
  try {
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      contents: [{ role: "user", parts: [{ text: `Extract atomic, objectively verifiable acceptance criteria from the source below. Quote the source exactly. Mark subjective, business-outcome, authenticated, payment, email, visual pixel-match, or otherwise unsafe criteria as unsupported with checkType manual. Never invent a path, selector, action, or requirement.\n\nSOURCE:\n${parsed.data.text}` }] }],
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
    const grounded = validated.criteria.map((criterion) => ({ ...criterion, grounded: parsed.data.text.includes(criterion.sourceQuote) }));
    return NextResponse.json({ criteria: grounded, requiresHumanConfirmation: true });
  } catch (error) {
    console.error("Gemini analysis failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "The document could not be analyzed. You can still enter criteria manually." }, { status: 502 });
  }
}

