import { NextResponse } from "next/server";
import { z } from "zod";
import { criterionResultSchema } from "@milestoneproof/contracts";
import { verifyRunnerRequest } from "@/lib/hmac";

const completionSchema = z.object({ attempt: z.number().int().positive(), buildLabel: z.string(), results: z.array(criterionResultSchema).min(1).max(40) });

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = completionSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return NextResponse.json({ error: "Invalid completion payload" }, { status: 422 });
  const { jobId } = await context.params;
  return NextResponse.json({ jobId, accepted: true, status: parsed.data.results.some((result) => result.status !== "PASS") ? "NEEDS_WORK" : "READY_FOR_REVIEW" });
}

