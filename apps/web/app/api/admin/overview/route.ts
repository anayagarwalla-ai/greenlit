import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { adminAccessAllowed } from "@/lib/beta-access";
import { getOptionalUser } from "@/lib/supabase-server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
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
      database.from("verification_jobs_v2").select("id, record_id, status, build_label, target_origin, last_error, acknowledged_at, acknowledged_by, retry_of, created_at, completed_at").in("status", ["QUEUED", "LEASED", "RUNNING", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("privacy_requests_v2").select("id, public_id, request_type, email, details, status, assigned_to, internal_notes, identity_verified_at, response_summary, response_sent_at, updated_at, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("operator_notifications").select("id, owner_user_id, record_id, event_type, title, body, payload, delivery_status, delivery_attempts, delivery_error, last_delivery_at, created_at").in("delivery_status", ["PENDING_EMAIL", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, status, created_at").gte("created_at", since),
    ]);
    const firstError = [feedback, events, jobs, privacy, notifications, recentRuns].find((result) => result.error)?.error;
    if (firstError) throw new Error(firstError.message);
    const staleBefore = Date.now() - 10 * 60_000;
    const jobIssues = (jobs.data ?? []).filter((job) => !job.acknowledged_at && (job.status === "FAILED" || new Date(job.created_at).getTime() < staleBefore));
    const openPrivacyRequests = (privacy.data ?? []).filter((item) => !["COMPLETED", "DENIED"].includes(item.status)).length;
    const usersByEmail = new Map<string, string>();
    for (let page = 1; page <= 5; page += 1) {
      const { data: users, error: usersError } = await database.auth.admin.listUsers({ page, perPage: 200 });
      if (usersError) throw new Error(usersError.message);
      for (const account of users.users) if (account.email) usersByEmail.set(account.email.toLowerCase(), account.id);
      if (users.users.length < 200) break;
    }
    const privacyWithRecords = await Promise.all((privacy.data ?? []).map(async (item) => {
      const ownerId = usersByEmail.get(item.email.toLowerCase());
      if (!ownerId) return { ...item, matchedRecords: [] };
      const { data: matchedRecords, error: matchedError } = await database.from("transaction_records").select("id, public_id, agency_name, client_name, project_name, milestone_title, status, legal_hold, retention_until, privacy_deletion_requested_at, deletion_status").eq("owner_user_id", ownerId).order("created_at", { ascending: false });
      if (matchedError) throw new Error(matchedError.message);
      return { ...item, matchedRecords: matchedRecords ?? [] };
    }));
    return NextResponse.json({
      operator: user.email,
      summary: {
        newFeedback: (feedback.data ?? []).filter((item) => item.status === "NEW").length,
        activeJobIssues: jobIssues.length,
        openPrivacyRequests,
        runsLast24Hours: (recentRuns.data ?? []).length,
      },
      feedback: feedback.data ?? [], events: events.data ?? [], jobs: jobIssues, privacy: privacyWithRecords, notifications: notifications.data ?? [],
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operator overview unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

const patchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feedback"), id: z.string().uuid(), status: z.enum(["NEW", "REVIEWING", "RESOLVED", "CLOSED"]) }),
  z.object({ kind: z.literal("privacy"), id: z.string().uuid(), status: z.enum(["RECEIVED", "VERIFYING", "PROCESSING", "COMPLETED", "DENIED"]), assignedTo: z.string().trim().max(160), internalNotes: z.string().trim().max(4_000), identityVerified: z.boolean(), responseSummary: z.string().trim().max(4_000), responseSent: z.boolean() }),
  z.object({ kind: z.literal("privacy_hold"), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ kind: z.literal("privacy_deletion"), id: z.string().uuid() }),
  z.object({ kind: z.literal("privacy_correction"), id: z.string().uuid(), recordId: z.string().uuid(), fieldName: z.enum(["agency_name", "client_name", "project_name", "milestone_title"]), correctedValue: z.string().trim().min(1).max(240), reason: z.string().trim().min(3).max(1_000) }),
  z.object({ kind: z.literal("job"), id: z.string().uuid(), action: z.enum(["acknowledge", "retry"]) }),
  z.object({ kind: z.literal("notification"), id: z.string().uuid(), action: z.literal("retry") }),
]);

export async function PATCH(request: Request) {
  const operator = await authorize();
  if (!operator) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid operator update." }, { status: 422, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  try {
    if (parsed.data.kind === "feedback") {
      const { error } = await database.rpc("update_feedback_status_atomic", { p_id: parsed.data.id, p_status: parsed.data.status, p_operator_email: operator.email });
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "privacy") {
      const { error } = await database.rpc("update_privacy_request_atomic", { p_id: parsed.data.id, p_status: parsed.data.status, p_assigned_to: parsed.data.assignedTo, p_internal_notes: parsed.data.internalNotes, p_identity_verified: parsed.data.identityVerified, p_response_summary: parsed.data.responseSummary, p_response_sent: parsed.data.responseSent, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "privacy_hold") {
      const { data: affected, error } = await database.rpc("set_privacy_legal_hold_atomic", { p_request_id: parsed.data.id, p_enabled: parsed.data.enabled, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: true, affected }, { headers: noStoreJsonHeaders() });
    } else if (parsed.data.kind === "privacy_deletion") {
      const { data: affected, error } = await database.rpc("schedule_privacy_deletion_atomic", { p_request_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: true, affected }, { headers: noStoreJsonHeaders() });
    } else if (parsed.data.kind === "privacy_correction") {
      const { data: amendmentId, error } = await database.rpc("record_privacy_correction_atomic", { p_request_id: parsed.data.id, p_record_id: parsed.data.recordId, p_field_name: parsed.data.fieldName, p_corrected_value: parsed.data.correctedValue, p_reason: parsed.data.reason, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: true, amendmentId }, { headers: noStoreJsonHeaders() });
    } else if (parsed.data.kind === "notification") {
      const { data: notification, error } = await database.rpc("prepare_notification_retry_atomic", { p_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() }).single();
      if (error || !notification) throw new Error(error?.message ?? "Notification not found.");
      await deliverNotification(notification as NotificationPayload);
    } else if (parsed.data.action === "acknowledge") {
      const { error } = await database.rpc("acknowledge_verification_job_atomic", { p_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
    } else {
      const { data: retried, error: retryError } = await database.rpc("retry_verification_job_atomic", { p_failed_job_id: parsed.data.id, p_operator_email: operator.email }).single();
      if (retryError || !retried) throw new Error(retryError?.message ?? "Retry job could not be created.");
      const job = retried as { jobId: string };
      const runnerUrl = process.env.RUNNER_URL; const secret = process.env.RUNNER_HMAC_SECRET;
      if (!runnerUrl || !secret) throw new Error("Runner dispatch is not configured.");
      const body = JSON.stringify({ jobId: job.jobId }); const signed = await signRunnerRequest(body, secret);
      const dispatched = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json", "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature }, body });
      if (!dispatched.ok) {
        await database.rpc("fail_verification_job_atomic", { p_job_id: job.jobId, p_attempt: 1, p_error: `Dispatch returned ${dispatched.status}`, p_event_type: "VERIFICATION_DISPATCH_FAILED" });
        throw new Error(`Runner retry dispatch returned ${dispatched.status}.`);
      }
    }
    return NextResponse.json({ updated: true }, { headers: noStoreJsonHeaders() });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Operator update failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
