import { NextResponse } from "next/server";
import { verifyRunnerRequest } from "@/lib/hmac";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await context.params;
  return NextResponse.json({
    jobId,
    targetOrigin: "https://example.com",
    buildLabel: "integration-smoke",
    checks: [{ id: "smoke-1", criterionId: "AC-SMOKE", type: "element_state", path: "/", sourceQuote: "The Example Domain heading is visible.", confirmedByHuman: true, elementRef: "heading:Example Domain", assertion: "visible" }],
  }, { headers: { "Cache-Control": "no-store" } });
}

