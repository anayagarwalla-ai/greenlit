import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { adminAccessAllowed } from "@/lib/beta-access";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { appendAuditEvent } from "@/lib/recordkeeping";
import { signRunnerRequest } from "@/lib/hmac";
import { deliverNotification, type NotificationPayload } from "@/lib/notifications";

async function authorize() {
  const user = await getOptionalUser();
  return user && adminAccessAllowed(user) ? user : null;
}

export async function GET() {
  const user = await authorize();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [feedback, events, jobs, privacy, notifications, recentRuns] = await Promise.all([
      database.from("beta_feedback").select("id, public_id, email, category, message, page_path, status, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("operational_events").select("id, severity, service, event_type, record_id, details, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, record_id, status, build_label, target_origin, last_error, acknowledged_at, acknowledged_by, retry_of, created_at, completed_at").in("status", ["QUEUED", "RUNNING", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("privacy_requests_v2").select("id, public_id, request_type, email, details, status, assigned_to, internal_notes, updated_at, created_at").neq("status", "COMPLETED").order("created_at", { ascending: false }).limit(100),
      database.from("operator_notifications").select("id, owner_user_id, record_id, event_type, title, body, payload, delivery_status, delivery_attempts, delivery_error, last_delivery_at, created_at").in("delivery_status", ["PENDING_EMAIL", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, status, created_at").gte("created_at", since),
    ]);
    const firstError = [feedback, events, jobs, privacy, notifications, recentRuns].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
    const staleBefore = Date.now() - 10 * 60_000;
    const jobIssues = (jobs.data ?? []).filter((job) => job.status === "FAILED" || new Date(job.created_at).getTime() < staleBefore);
    return NextResponse.json({
      operator: user.email,
      summary: {
        newFeedback: (feedback.data ?? []).filter((item) => item.status === "NEW").length,
        activeJobIssues: jobIssues.length,
        openPrivacyRequests: (privacy.data ?? []).length,
        runsLast24Hours: (recentRuns.data ?? []).length,
      },
      feedback: feedback.data ?? [], events: events.data ?? [], jobs: jobIssues, privacy: privacy.data ?? [], notifications: notifications.data ?? [],
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operator overview unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

const patchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feedback"), id: z.string().uuid(), status: z.enum(["NEW", "REVIEWING", "RESOLVED", "CLOSED"]) }),
  z.object({ kind: z.literal("privacy"), id: z.string().uuid(), status: z.enum(["RECEIVED", "VERIFYING", "PROCESSING", "COMPLETED", "DENIED"]), assignedTo: z.string().trim().max(160), internalNotes: z.string().trim().max(4_000) }),
  z.object({ kind: z.literal("job"), id: z.string().uuid(), action: z.enum(["acknowledge", "retry"]) }),
  z.object({ kind: z.literal("notification"), id: z.string().uuid(), action: z.literal("retry") }),
]);

export async function PATCH(request: Request) {
  if (!await authorize()) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid operator update." }, { status: 422, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  try {
    if (parsed.data.kind === "feedback") {
      const { error } = await database.from("beta_feedback").update({ status: parsed.data.status }).eq("id", parsed.data.id);
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "privacy") {
      const { error } = await database.from("privacy_requests_v2").update({ status: parsed.data.status, assigned_to: parsed.data.assignedTo || null, internal_notes: parsed.data.internalNotes || null, updated_at: new Date().toISOString(), completed_at: parsed.data.status === "COMPLETED" ? new Date().toISOString() : null }).eq("id", parsed.data.id);
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "notification") {
      const { data: notification, error } = await database.from("operator_notifications").select("id, owner_user_id, record_id, event_type, title, body, payload, created_at").eq("id", parsed.data.id).single();
      if (error || !notification) throw new Error(error?.message ?? "Notification not found.");
      await database.from("operator_notifications").update({ delivery_status: "PENDING_EMAIL", delivery_attempts: 0, delivery_error: null, last_delivery_at: new Date().toISOString() }).eq("id", parsed.data.id);
      await deliverNotification(notification as NotificationPayload);
    } else if (parsed.data.action === "acknowledge") {
      const user = await authorize();
      const { error } = await database.from("verification_jobs_v2").update({ acknowledged_at: new Date().toISOString(), acknowledged_by: user?.email ?? "operator" }).eq("id", parsed.data.id);
      if (error) throw new Error(error.message);
    } else {
      const { data: failed, error } = await database.from("verification_jobs_v2").select("*").eq("id", parsed.data.id).eq("status", "FAILED").single();
      if (error || !failed) throw new Error("Only failed jobs can be retried.");
      const { data: retry, error: insertError } = await database.from("verification_jobs_v2").insert({ record_id: failed.record_id, status: "QUEUED", target_origin: failed.target_origin, build_url: failed.build_url, build_label: failed.build_label, checks: failed.checks, runner_version: failed.runner_version, retry_of: failed.id }).select("id").single();
      if (insertError || !retry) throw new Error(insertError?.message ?? "Retry job could not be created.");
      await database.from("transaction_records").update({ status: "VERIFYING" }).eq("id", failed.record_id);
      await appendAuditEvent({ recordId: failed.record_id, eventType: "VERIFICATION_RETRIED", actorType: "SYSTEM", payload: { failedJobId: failed.id, retryJobId: retry.id } });
      const runnerUrl = process.env.RUNNER_URL; const secret = process.env.RUNNER_HMAC_SECRET;
      if (!runnerUrl || !secret) throw new Error("Runner dispatch is not configured.");
      const body = JSON.stringify({ jobId: retry.id }); const signed = await signRunnerRequest(body, secret);
      const dispatched = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json", "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature }, body });
      if (!dispatched.ok) throw new Error(`Runner retry dispatch returned ${dispatched.status}.`);
    }
    return NextResponse.json({ updated: true }, { headers: noStoreJsonHeaders() });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Operator update failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
