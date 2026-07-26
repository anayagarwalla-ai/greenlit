import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOperationalControl, internalRunsPauseResponse } from "@/lib/operational-controls";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { readLimitedBody, RequestSizeError, requestTooLargeResponse } from "@/lib/request-security";

const leaseRequestSchema = z.object({ attempt: z.number().int().min(1).max(5), leaseId: z.string().uuid() });

type LeaseError = { message?: string | null; details?: string | null };

function isRunsPauseError(error?: LeaseError | null) {
  const message = error?.message ?? "";
  const detail = error?.details ?? "";
  return (
    ["RUNS_PAUSED", "RUNS_UNAVAILABLE"].includes(detail)
    || /^Operational capability RUNS is (paused|unavailable)$/.test(message)
  );
}

function leaseRejection(error?: LeaseError | null) {
  const message = error?.message ?? "";
  if (isRunsPauseError(error)) return internalRunsPauseResponse(true);
  if (message.startsWith("Job cannot be leased from ")) {
    return NextResponse.json(
      {
        error: "This job was already leased or reached a terminal state.",
        code: "LEASE_ALREADY_RESOLVED",
        retryable: false,
      },
      { status: 409, headers: noStoreJsonHeaders() },
    );
  }
  if (message.includes("Job not found")) {
    return NextResponse.json(
      { error: "The verification job was not found.", code: "JOB_NOT_FOUND", retryable: false },
      { status: 404, headers: noStoreJsonHeaders() },
    );
  }
  return NextResponse.json(
    { error: "The verification job could not be leased.", code: "LEASE_REJECTED", retryable: true },
    { status: 409, headers: noStoreJsonHeaders() },
  );
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  let body: string;
  try { body = await readLimitedBody(request, 8_000); }
  catch (error) { if (error instanceof RequestSizeError) return requestTooLargeResponse(error.maxBytes); throw error; }
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = leaseRequestSchema.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ error: "Invalid lease request." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const runControl = await getOperationalControl("RUNS");
    if (runControl.paused) return internalRunsPauseResponse(true);
  } catch {
    return internalRunsPauseResponse(true);
  }

  const { jobId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.rpc("lease_verification_job_atomic", { p_job_id: jobId, p_attempt: parsed.data.attempt, p_lease_id: parsed.data.leaseId }).single();
    if (error || !job) return leaseRejection(error);
    const leased = job as { target_origin: string; checks: unknown; build_label: string; started_at: string; origin_addresses: unknown };
    const originAddresses = Array.isArray(leased.origin_addresses) ? leased.origin_addresses.filter((item): item is string => typeof item === "string") : [];
    if (originAddresses.length === 0) return NextResponse.json({ error: "The job has no frozen DNS addresses." }, { status: 409, headers: noStoreJsonHeaders() });
    return NextResponse.json({ jobId, leaseId: parsed.data.leaseId, targetOrigin: leased.target_origin, checks: leased.checks, buildLabel: leased.build_label, startedAt: leased.started_at, originAddresses }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (isRunsPauseError(error as LeaseError)) return internalRunsPauseResponse(true);
    console.error("Runner lease failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Lease failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
