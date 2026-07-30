import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { verifyOriginProof } from "@/lib/origin-proof";
import { getOperationalControl, internalRunsPauseResponse } from "@/lib/operational-controls";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { readLimitedBody, RequestSizeError, requestTooLargeResponse } from "@/lib/request-security";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";

export const runtime = "nodejs";

const schema = z.object({
  origin: z.string().url().max(2_000),
  originReceipt: z.string().min(20).max(4_000),
  userId: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  let body: string;
  try {
    body = await readLimitedBody(request, 8_192);
  } catch (error) {
    if (error instanceof RequestSizeError) return requestTooLargeResponse(error.maxBytes);
    throw error;
  }
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  }
  const parsed = schema.safeParse((() => {
    try { return JSON.parse(body); } catch { return null; }
  })());
  if (!parsed.success) return NextResponse.json({ error: "Invalid discovery validation request." }, { status: 422, headers: noStoreJsonHeaders() });

  try {
    const runControl = await getOperationalControl("RUNS");
    if (runControl.paused) return internalRunsPauseResponse(false);
  } catch {
    return internalRunsPauseResponse(false);
  }

  try {
    const validated = validateStagingUrl(parsed.data.origin);
    if (!validated.ok || validated.url.origin !== parsed.data.origin) throw new Error("Invalid origin");
    if (!verifyOriginProof(parsed.data.originReceipt, validated.url.origin, parsed.data.userId)) {
      return NextResponse.json({ error: "The staging-origin verification expired." }, { status: 409, headers: noStoreJsonHeaders() });
    }
    const [v4, v6] = await Promise.all([
      resolve4(validated.url.hostname).catch(() => []),
      resolve6(validated.url.hostname).catch(() => []),
    ]);
    const addresses = [...v4, ...v6].sort();
    assertSafeResolvedAddresses(addresses);
    return NextResponse.json({ origin: validated.url.origin, addresses }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "The verified origin now resolves to an unsafe or unavailable address." }, { status: 422, headers: noStoreJsonHeaders() });
  }
}
