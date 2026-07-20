import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, noStoreJsonHeaders } from "@/lib/recordkeeping";

const leaseRequestSchema = z.object({ attempt: z.number().int().min(1).max(5) });

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = leaseRequestSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return NextResponse.json({ error: "Invalid lease request." }, { status: 422, headers: noStoreJsonHeaders() });

  const { jobId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.from("verification_jobs_v2")
      .select("id, record_id, status, target_origin, checks, build_label")
      .eq("id", jobId)
      .single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (!new Set(["QUEUED", "LEASED", "RUNNING"]).has(job.status)) return NextResponse.json({ error: `Job cannot be leased from ${job.status}.` }, { status: 409, headers: noStoreJsonHeaders() });

    const startedAt = new Date().toISOString();
    const { error: updateError } = await database.from("verification_jobs_v2").update({ status: "RUNNING", attempt: parsed.data.attempt, started_at: startedAt, last_error: null }).eq("id", jobId);
    if (updateError) throw new Error(updateError.message);
    await appendAuditEvent({ recordId: job.record_id, eventType: "VERIFICATION_STARTED", actorType: "RUNNER", payload: { jobId, attempt: parsed.data.attempt, buildLabel: job.build_label } });

    return NextResponse.json({ jobId, targetOrigin: job.target_origin, checks: job.checks, buildLabel: job.build_label, startedAt }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lease failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
