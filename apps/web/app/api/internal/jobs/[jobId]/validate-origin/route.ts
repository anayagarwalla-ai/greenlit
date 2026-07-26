import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { z } from "zod";
import { readLimitedBody, RequestSizeError, requestTooLargeResponse } from "@/lib/request-security";
import { getOperationalControl, internalRunsPauseResponse } from "@/lib/operational-controls";

export const runtime = "nodejs";
const schema = z.object({ leaseId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  let body: string;
  try { body = await readLimitedBody(request, 8_000); }
  catch (error) { if (error instanceof RequestSizeError) return requestTooLargeResponse(error.maxBytes); throw error; }
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = schema.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ error: "Invalid origin-validation request." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const runControl = await getOperationalControl("RUNS");
    if (runControl.paused) return internalRunsPauseResponse(false);
  } catch {
    return internalRunsPauseResponse(false);
  }
  const { jobId } = await context.params;
  try {
    const { data: job, error } = await requireSupabaseAdmin().from("verification_jobs_v2").select("target_origin, status, lease_id").eq("id", jobId).single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (job.status !== "RUNNING") return NextResponse.json({ error: "Job is not actively leased." }, { status: 409, headers: noStoreJsonHeaders() });
    if (job.lease_id !== parsed.data.leaseId) return NextResponse.json({ error: "This origin check belongs to a stale or replayed runner lease." }, { status: 409, headers: noStoreJsonHeaders() });
    const target = validateStagingUrl(job.target_origin);
    if (!target.ok || target.url.origin !== job.target_origin) return NextResponse.json({ error: "The frozen origin is no longer valid." }, { status: 422, headers: noStoreJsonHeaders() });
    const [v4, v6] = await Promise.all([resolve4(target.url.hostname).catch(() => []), resolve6(target.url.hostname).catch(() => [])]);
    const addresses = [...v4, ...v6];
    assertSafeResolvedAddresses(addresses);
    // CDN and geo-DNS answers legitimately rotate. The security property is
    // that every current answer is public and the browser's actual connected
    // address belongs to this freshly resolved set, not that it equals the
    // resolver answer captured when the job was queued.
    return NextResponse.json({ origin: target.url.origin, addresses }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "The verified origin now resolves to an unsafe or unavailable address." }, { status: 422, headers: noStoreJsonHeaders() });
  }
}
