import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { logOperationalEvent } from "@/lib/operations";

const schema = z.object({ attempt: z.number().int().positive(), error: z.string().min(1).max(300) });

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = schema.safeParse(JSON.parse(body));
  if (!parsed.success) return NextResponse.json({ error: "Invalid failure payload." }, { status: 422, headers: noStoreJsonHeaders() });
  const { jobId } = await context.params;

  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.from("verification_jobs_v2").select("record_id").eq("id", jobId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const { data: outcome, error: failError } = await database.rpc("fail_verification_job_atomic", { p_job_id: jobId, p_attempt: parsed.data.attempt, p_error: parsed.data.error, p_event_type: "VERIFICATION_FAILED" });
    if (failError) throw new Error(failError.message);
    if (outcome === "FAILED") {
      await logOperationalEvent({ severity: "ERROR", service: "runner", eventType: "VERIFICATION_FAILED", recordId: job.record_id, details: { jobId, attempt: parsed.data.attempt, error: parsed.data.error } });
    }
    return NextResponse.json({ jobId, accepted: true }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failure could not be recorded." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
