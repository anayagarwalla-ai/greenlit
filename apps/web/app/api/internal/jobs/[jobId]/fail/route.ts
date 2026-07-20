import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, noStoreJsonHeaders } from "@/lib/recordkeeping";

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
    const { data: job, error } = await database.from("verification_jobs_v2").select("record_id, status").eq("id", jobId).single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (job.status !== "COMPLETED") {
      await database.from("verification_jobs_v2").update({ status: "FAILED", attempt: parsed.data.attempt, last_error: parsed.data.error, completed_at: new Date().toISOString() }).eq("id", jobId);
      await database.from("transaction_records").update({ status: "READY" }).eq("id", job.record_id);
      await appendAuditEvent({ recordId: job.record_id, eventType: "VERIFICATION_FAILED", actorType: "RUNNER", payload: { jobId, attempt: parsed.data.attempt, error: parsed.data.error } });
    }
    return NextResponse.json({ jobId, accepted: true }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failure could not be recorded." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
