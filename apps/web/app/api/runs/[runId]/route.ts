import { NextResponse } from "next/server";
import { demoCriteria } from "@/lib/demo";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const passing = runId.includes("rc2") || runId.includes("2048");
  return NextResponse.json({ runId, status: "COMPLETED", outcome: passing ? "READY_FOR_REVIEW" : "NEEDS_WORK", results: demoCriteria.map((criterion) => ({ criterionId: criterion.id, status: passing ? criterion.result.rc2 : criterion.result.rc1, expected: criterion.result.expected, observed: passing ? criterion.result.observedRc2 : criterion.result.observedRc1 })) }, { headers: { "Cache-Control": "no-store" } });
}

