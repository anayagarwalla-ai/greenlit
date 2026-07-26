import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { getAdminAuthorization } from "@/lib/admin-auth";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { signRunnerRequest } from "@/lib/hmac";
import { deliverNotification, type NotificationPayload } from "@/lib/notifications";
import { processInvoiceJob } from "@/lib/stripe-invoicing";
import { getOperationalControl, operationalPauseResponse } from "@/lib/operational-controls";
import { readLimitedJsonResult } from "@/lib/request-security";
import { deauthorizeStripeAccount } from "@/lib/stripe-api";

async function authorize() {
  const auth = await getAdminAuthorization();
  return auth.aal2 ? auth.user : null;
}

async function authUserIdForEmail(database: ReturnType<typeof requireSupabaseAdmin>, email: string) {
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await database.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`The privacy subject account could not be resolved: ${error.message}`);
    const matched = data.users.find((account) => account.email?.toLowerCase() === email.toLowerCase());
    if (matched) return matched.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export async function GET() {
  const user = await authorize();
  if (!user) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const staleNotificationBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const [feedback, events, jobs, privacy, notifications, recentRuns, deletionFailures, maintenance, invites, holds, accountDeletionFailures, invoiceJobs] = await Promise.all([
      database.from("beta_feedback").select("id, public_id, email, category, message, page_path, status, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("operational_events").select("id, severity, service, event_type, record_id, details, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, record_id, status, build_label, target_origin, last_error, acknowledged_at, acknowledged_by, retry_of, created_at, completed_at").in("status", ["QUEUED", "LEASED", "RUNNING", "FAILED"]).order("created_at", { ascending: false }).limit(100),
      database.from("privacy_requests_v2").select("id, public_id, request_type, email, details, status, assigned_to, internal_notes, identity_verified_at, response_summary, response_sent_at, updated_at, created_at").order("created_at", { ascending: false }).limit(100),
      database.from("operator_notifications").select("id, owner_user_id, record_id, event_type, title, body, payload, delivery_status, delivery_attempts, delivery_error, delivery_claimed_at, last_delivery_at, created_at").or(`delivery_status.in.(PENDING_EMAIL,FAILED),and(delivery_status.eq.SENDING,delivery_claimed_at.lt.${staleNotificationBefore})`).order("created_at", { ascending: false }).limit(100),
      database.from("verification_jobs_v2").select("id, status, created_at").gte("created_at", since),
      database.from("transaction_records").select("id, public_id, project_name, deletion_status, deletion_error, deletion_requested_at").eq("deletion_status", "FAILED").order("deletion_requested_at", { ascending: false }).limit(100),
      database.from("maintenance_runs").select("id, task, status, started_at, completed_at, summary, error").order("started_at", { ascending: false }).limit(20),
      database.from("beta_invites").select("id, email, status, adult_sponsor, invited_by, invited_at, removed_at, last_sign_in_requested_at").order("invited_at", { ascending: false }).limit(200),
      database.from("legal_holds_v2").select("id,record_id,privacy_request_id,reason,owner_email,review_at,active,created_at,released_at,released_by").eq("active", true).order("created_at", { ascending: false }).limit(500),
      database.from("privacy_account_deletions").select("id,request_id,email,status,attempts,last_error,requested_at,completed_at").eq("status", "FAILED").order("requested_at", { ascending: false }).limit(100),
      database.from("invoice_jobs").select("id,record_id,owner_user_id,status,attempts,last_error,claimed_at,created_at,updated_at").in("status", ["FAILED", "PROCESSING"]).order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = [feedback, events, jobs, privacy, notifications, recentRuns, deletionFailures, maintenance, invites, holds, accountDeletionFailures, invoiceJobs].find((result) => result.error)?.error;
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
      const { data: subjectRecords, error: subjectError } = await database.rpc("privacy_subject_record_ids", { p_email: item.email });
      if (subjectError) throw new Error(subjectError.message);
      const ids = (subjectRecords ?? []).map((row: { record_id: string }) => row.record_id);
      const { data: matchedRecords, error: matchedError } = ids.length ? await database.from("transaction_records").select("id, public_id, agency_name, client_name, project_name, milestone_title, status, legal_hold, retention_until, privacy_deletion_requested_at, deletion_status").in("id", ids).order("created_at", { ascending: false }) : { data: [], error: null };
      if (matchedError) throw new Error(matchedError.message);
      return { ...item, accountUserId: usersByEmail.get(item.email.toLowerCase()) ?? null, matchedRecords: matchedRecords ?? [], activeHolds: (holds.data ?? []).filter((hold) => hold.privacy_request_id === item.id) };
    }));
    return NextResponse.json({
      operator: user.email,
      summary: {
        newFeedback: (feedback.data ?? []).filter((item) => item.status === "NEW").length,
        activeJobIssues: jobIssues.length + (invoiceJobs.data ?? []).length,
        openPrivacyRequests,
        runsLast24Hours: (recentRuns.data ?? []).length,
      },
      feedback: feedback.data ?? [], events: events.data ?? [], jobs: jobIssues, invoiceJobs: invoiceJobs.data ?? [], privacy: privacyWithRecords, notifications: notifications.data ?? [], deletionFailures: deletionFailures.data ?? [], accountDeletionFailures: accountDeletionFailures.data ?? [], maintenance: maintenance.data ?? [], invites: invites.data ?? [],
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operator overview unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

const patchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feedback"), id: z.string().uuid(), status: z.enum(["NEW", "REVIEWING", "RESOLVED", "CLOSED"]) }),
  z.object({ kind: z.literal("privacy"), id: z.string().uuid(), status: z.enum(["RECEIVED", "VERIFYING", "PROCESSING", "COMPLETED", "DENIED"]), assignedTo: z.string().trim().max(160), internalNotes: z.string().trim().max(4_000), responseSummary: z.string().trim().max(4_000), responseSent: z.boolean() }),
  z.object({ kind: z.literal("privacy_hold"), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ kind: z.literal("privacy_deletion"), id: z.string().uuid() }),
  z.object({ kind: z.literal("privacy_correction"), id: z.string().uuid(), recordId: z.string().uuid(), fieldName: z.enum(["agency_name", "client_name", "project_name", "milestone_title"]), correctedValue: z.string().trim().min(1).max(240), reason: z.string().trim().min(3).max(1_000) }),
  z.object({ kind: z.literal("record_deletion"), id: z.string().uuid(), action: z.literal("retry") }),
  z.object({ kind: z.literal("invite"), email: z.string().trim().email().max(320), action: z.enum(["activate", "remove"]), responsibleOperator: z.string().trim().min(2).max(160) }),
  z.object({ kind: z.literal("job"), id: z.string().uuid(), action: z.enum(["acknowledge", "retry", "expire"]), reason: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("notification"), id: z.string().uuid(), action: z.literal("retry") }),
  z.object({ kind: z.literal("invoice_job"), id: z.string().uuid(), action: z.literal("retry") }),
]);

export async function PATCH(request: Request) {
  const operator = await authorize();
  if (!operator) return NextResponse.json({ error: "Operator access required." }, { status: 403, headers: noStoreJsonHeaders() });
  const limited = await readLimitedJsonResult(request, 16_384);
  if (!limited.ok) return limited.response;
  const parsed = patchSchema.safeParse(limited.body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid operator update." }, { status: 422, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  try {
    if (parsed.data.kind === "feedback") {
      const { error } = await database.rpc("update_feedback_status_atomic", { p_id: parsed.data.id, p_status: parsed.data.status, p_operator_email: operator.email });
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "privacy") {
      const { data: requestState, error: stateError } = await database.from("privacy_requests_v2").select("identity_verified_at").eq("id", parsed.data.id).single();
      if (stateError || !requestState) throw new Error("Privacy request not found.");
      const { error } = await database.rpc("update_privacy_request_atomic", { p_id: parsed.data.id, p_status: parsed.data.status, p_assigned_to: parsed.data.assignedTo, p_internal_notes: parsed.data.internalNotes, p_identity_verified: Boolean(requestState.identity_verified_at), p_response_summary: parsed.data.responseSummary, p_response_sent: parsed.data.responseSent, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "privacy_hold") {
      const { data: affected, error } = await database.rpc("set_privacy_legal_hold_atomic", { p_request_id: parsed.data.id, p_enabled: parsed.data.enabled, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: true, affected }, { headers: noStoreJsonHeaders() });
    } else if (parsed.data.kind === "privacy_deletion") {
      const { data: privacyRequest, error: privacyRequestError } = await database
        .from("privacy_requests_v2")
        .select("email")
        .eq("id", parsed.data.id)
        .single();
      if (privacyRequestError || !privacyRequest) throw new Error("Privacy request not found.");
      const subjectUserId = await authUserIdForEmail(database, privacyRequest.email);
      if (subjectUserId) {
        const [{ count: processingInvoices, error: invoiceCheckError }, { data: stripeConnection, error: stripeReadError }] = await Promise.all([
          database.from("invoice_jobs").select("id", { head: true, count: "exact" }).eq("owner_user_id", subjectUserId).eq("status", "PROCESSING"),
          database.from("stripe_connections").select("stripe_account_id,status").eq("owner_user_id", subjectUserId).maybeSingle(),
        ]);
        if (invoiceCheckError || stripeReadError) throw new Error(invoiceCheckError?.message ?? stripeReadError?.message ?? "Privacy deletion prerequisites could not be checked.");
        if ((processingInvoices ?? 0) > 0) throw new Error("Resolve the processing invoice before scheduling account deletion.");
        if (stripeConnection?.status === "CONNECTED" && stripeConnection.stripe_account_id) {
          await deauthorizeStripeAccount(stripeConnection.stripe_account_id);
          const { error: disconnectError } = await database.rpc("disconnect_stripe_account_atomic", {
            p_owner_user_id: subjectUserId,
            p_disconnected_at: new Date().toISOString(),
            p_reason: "Stripe authorization removed for a verified privacy deletion request.",
          });
          if (disconnectError) throw new Error(`Stripe authorization was removed, but the local connection could not be finalized: ${disconnectError.message}`);
        }
      }
      const { data: affected, error } = await database.rpc("schedule_privacy_deletion_with_demo_atomic", { p_request_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: true, affected }, { headers: noStoreJsonHeaders() });
    } else if (parsed.data.kind === "privacy_correction") {
      const { data: amendmentId, error } = await database.rpc("record_privacy_correction_atomic", { p_request_id: parsed.data.id, p_record_id: parsed.data.recordId, p_field_name: parsed.data.fieldName, p_corrected_value: parsed.data.correctedValue, p_reason: parsed.data.reason, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: true, amendmentId }, { headers: noStoreJsonHeaders() });
    } else if (parsed.data.kind === "record_deletion") {
      const { data: updated, error } = await database.rpc("retry_record_deletion_atomic", { p_record_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error || !updated) throw new Error(error?.message ?? "Failed deletion was not found.");
    } else if (parsed.data.kind === "invite") {
      const normalizedEmail = parsed.data.email.toLowerCase();
      const { error } = await database.rpc("manage_beta_invite_atomic", { p_email: normalizedEmail, p_status: parsed.data.action === "activate" ? "ACTIVE" : "REMOVED", p_responsible_operator: parsed.data.responsibleOperator, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
    } else if (parsed.data.kind === "notification") {
      const { data: notification, error } = await database.rpc("prepare_notification_retry_atomic", { p_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() }).single();
      if (error || !notification) throw new Error(error?.message ?? "Notification not found.");
      await deliverNotification(notification as NotificationPayload);
    } else if (parsed.data.kind === "invoice_job") {
      const { data: job, error } = await database.from("invoice_jobs").select("id,owner_user_id,status").eq("id", parsed.data.id).maybeSingle();
      if (error || !job || job.status !== "FAILED") throw new Error(error?.message ?? "Failed invoice job not found.");
      const result = await processInvoiceJob(job.id, job.owner_user_id);
      if (result.status === "PAUSED") return operationalPauseResponse(result.control);
    } else if (parsed.data.action === "acknowledge") {
      const { error } = await database.rpc("acknowledge_verification_job_atomic", { p_id: parsed.data.id, p_operator_email: operator.email, p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
    } else if (parsed.data.action === "expire") {
      const { error } = await database.rpc("resolve_verification_job_atomic", { p_job_id: parsed.data.id, p_operator_email: operator.email, p_reason: parsed.data.reason || "Closed after operator review.", p_now: new Date().toISOString() });
      if (error) throw new Error(error.message);
    } else {
      const runControl = await getOperationalControl("RUNS");
      if (runControl.paused) return operationalPauseResponse(runControl);
      const { data: retried, error: retryError } = await database.rpc("retry_verification_job_atomic", { p_failed_job_id: parsed.data.id, p_operator_email: operator.email }).single();
      if (retryError || !retried) throw new Error(retryError?.message ?? "Retry job could not be created.");
      const job = retried as { jobId: string };
      const runnerUrl = process.env.RUNNER_URL; const secret = process.env.RUNNER_HMAC_SECRET;
      if (!runnerUrl || !secret) throw new Error("Runner dispatch is not configured.");
      const body = JSON.stringify({ jobId: job.jobId }); const signed = await signRunnerRequest(body, secret);
      try {
        const dispatched = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json", "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature }, body, signal: AbortSignal.timeout(8_000) });
        if (!dispatched.ok) throw new Error(`Runner retry dispatch returned ${dispatched.status}.`);
      } catch (dispatchError) {
        const message = dispatchError instanceof Error ? dispatchError.message : "Runner retry dispatch failed.";
        await database.rpc("fail_queued_verification_job_atomic", { p_job_id: job.jobId, p_error: message.slice(0, 300), p_event_type: "VERIFICATION_DISPATCH_FAILED" });
        throw new Error(message);
      }
    }
    return NextResponse.json({ updated: true }, { headers: noStoreJsonHeaders() });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Operator update failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
