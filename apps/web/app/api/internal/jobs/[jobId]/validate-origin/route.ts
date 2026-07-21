import { resolve4, resolve6 } from "node:dns/promises";
import { NextResponse } from "next/server";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const { jobId } = await context.params;
  try {
    const { data: job, error } = await requireSupabaseAdmin().from("verification_jobs_v2").select("target_origin, status").eq("id", jobId).single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (!["QUEUED", "LEASED", "RUNNING"].includes(job.status)) return NextResponse.json({ error: "Job is not active." }, { status: 409, headers: noStoreJsonHeaders() });
    const target = validateStagingUrl(job.target_origin);
    if (!target.ok || target.url.origin !== job.target_origin) return NextResponse.json({ error: "The frozen origin is no longer valid." }, { status: 422, headers: noStoreJsonHeaders() });
    const [v4, v6] = await Promise.all([resolve4(target.url.hostname).catch(() => []), resolve6(target.url.hostname).catch(() => [])]);
    const addresses = [...v4, ...v6];
    assertSafeResolvedAddresses(addresses);
    return NextResponse.json({ origin: target.url.origin, addresses }, { headers: noStoreJsonHeaders() });
  } catch {
    return NextResponse.json({ error: "The verified origin now resolves to an unsafe or unavailable address." }, { status: 422, headers: noStoreJsonHeaders() });
  }
}
