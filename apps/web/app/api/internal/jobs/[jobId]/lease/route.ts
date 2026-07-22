import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";

const leaseRequestSchema = z.object({ attempt: z.number().int().min(1).max(5), leaseId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = leaseRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return NextResponse.json({ error: "Invalid lease request." }, { status: 422, headers: noStoreJsonHeaders() });

  const { jobId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.rpc("lease_verification_job_atomic", { p_job_id: jobId, p_attempt: parsed.data.attempt, p_lease_id: parsed.data.leaseId }).single();
    if (error || !job) return NextResponse.json({ error: error?.message ?? "Job could not be leased." }, { status: error?.message?.includes("not found") ? 404 : 409, headers: noStoreJsonHeaders() });
    const leased = job as { target_origin: string; checks: unknown; build_label: string; started_at: string; origin_addresses: unknown };
    const originAddresses = Array.isArray(leased.origin_addresses) ? leased.origin_addresses.filter((item): item is string => typeof item === "string") : [];
    if (originAddresses.length === 0) return NextResponse.json({ error: "The job has no frozen DNS addresses." }, { status: 409, headers: noStoreJsonHeaders() });
    return NextResponse.json({ jobId, leaseId: parsed.data.leaseId, targetOrigin: leased.target_origin, checks: leased.checks, buildLabel: leased.build_label, startedAt: leased.started_at, originAddresses }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lease failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
