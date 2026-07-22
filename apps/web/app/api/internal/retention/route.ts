import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { deliverPendingNotifications } from "@/lib/notifications";
import { processInvoiceJob } from "@/lib/stripe-invoicing";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Retention maintenance is not configured." }, { status: 503, headers: noStoreJsonHeaders() });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });

  const database = requireSupabaseAdmin();
  let maintenanceRunId: number | null = null;
  try {
    const now = new Date().toISOString();
    const { data: maintenanceRun, error: maintenanceStartError } = await database.from("maintenance_runs").insert({ task: "retention-and-recovery", status: "RUNNING", started_at: now }).select("id").single();
    if (maintenanceStartError) throw new Error(`Maintenance heartbeat could not start: ${maintenanceStartError.message}`);
    maintenanceRunId = Number(maintenanceRun.id);
    const staleBefore = new Date(Date.now() - 12 * 60_000).toISOString();
    const { data: strandedInvoiceJobs, error: strandedInvoiceError } = await database.from("invoice_jobs").select("id").eq("status", "PROCESSING").lt("claimed_at", staleBefore).limit(25);
    if (strandedInvoiceError) throw new Error(strandedInvoiceError.message);
    for (const job of strandedInvoiceJobs ?? []) await database.rpc("fail_invoice_job_atomic", { p_job_id: job.id, p_error: "Invoice processing exceeded the recovery window.", p_failed_at: now });
    const { data: pendingInvoiceJobs, error: pendingInvoiceError } = await database.from("invoice_jobs").select("id,owner_user_id").eq("status", "PENDING").order("created_at").limit(3);
    if (pendingInvoiceError) throw new Error(pendingInvoiceError.message);
    let recoveredInvoices = 0;
    for (const job of pendingInvoiceJobs ?? []) {
      try { const result = await processInvoiceJob(job.id, job.owner_user_id); if (result.status === "COMPLETED") recoveredInvoices += 1; }
      catch { /* processInvoiceJob records the durable failure and audit event */ }
    }
    const { data: expiredJobs, error: staleJobError } = await database.rpc("expire_stale_verification_jobs_atomic", { p_stale_before: staleBefore, p_operator_email: "system:retention", p_limit: 50 });
    if (staleJobError) throw new Error(`Stale verification recovery failed: ${staleJobError.message}`);
    const { data: stagedEvidence, error: evidenceStageError } = await database.rpc("stage_expired_evidence_deletion", { p_limit: 500, p_now: now });
    if (evidenceStageError) throw new Error(evidenceStageError.message);
    const byRecord = new Map<string, Array<{ id: string; storage_path: string | null }>>();
    for (const item of (stagedEvidence ?? []) as Array<{ id: string; record_id: string; storage_path: string | null }>) byRecord.set(item.record_id, [...(byRecord.get(item.record_id) ?? []), { id: item.id, storage_path: item.storage_path }]);
    let deletedEvidenceCount = 0;
    let evidenceDeletionFailures = 0;
    for (const [recordId, items] of byRecord) {
      try {
        const paths = items.flatMap((item) => item.storage_path ? [item.storage_path] : []);
        if (paths.length > 0) {
          const { error } = await database.storage.from("evidence").remove(paths);
          if (error) throw new Error(`Expired evidence could not be removed: ${error.message}`);
        }
        const { data: purgedCount, error: purgeError } = await database.rpc("finalize_evidence_deletion_atomic", { p_ids: items.map((item) => item.id), p_record_id: recordId, p_processed_at: now });
        if (purgeError) throw new Error(purgeError.message);
        deletedEvidenceCount += Number(purgedCount ?? 0);
      } catch (cause) {
        evidenceDeletionFailures += items.length;
        const message = cause instanceof Error ? cause.message : "Evidence deletion failed";
        const { error: failureError } = await database.rpc("fail_evidence_deletion_atomic", { p_ids: items.map((item) => item.id), p_record_id: recordId, p_error: message, p_processed_at: now });
        if (failureError) await database.from("operational_events").insert({ severity: "ERROR", service: "retention", event_type: "EVIDENCE_DELETION_STATE_FAILED", record_id: recordId, details: { error: failureError.message } });
      }
    }

    const { data: expiredRecords, error: recordsError } = await database.rpc("stage_expired_record_deletion", { p_limit: 50, p_now: now });
    if (recordsError) throw new Error(recordsError.message);
    let purgedRecords = 0;
    let recordDeletionFailures = 0;
    for (const record of (expiredRecords ?? []) as Array<{ id: string }>) {
      try {
        const { data: remainingArtifacts, error: artifactReadError } = await database.from("evidence_artifacts_v2").select("storage_path").eq("record_id", record.id);
        if (artifactReadError) throw new Error(artifactReadError.message);
        const paths = (remainingArtifacts ?? []).flatMap((item) => item.storage_path ? [item.storage_path] : []);
        if (paths.length > 0) {
          const { error } = await database.storage.from("evidence").remove(paths);
          if (error) throw new Error(`Record evidence could not be removed: ${error.message}`);
        }
        const { data, error } = await database.rpc("finalize_expired_record_deletion", { p_record_id: record.id });
        if (error || data !== true) throw new Error(error?.message ?? "Record deletion finalization was refused.");
        purgedRecords += 1;
      } catch (cause) {
        recordDeletionFailures += 1;
        const message = cause instanceof Error ? cause.message : "Record deletion failed";
        const { error: failureError } = await database.rpc("fail_record_deletion_atomic", { p_record_id: record.id, p_error: message });
        if (failureError) await database.from("operational_events").insert({ severity: "ERROR", service: "retention", event_type: "RECORD_DELETION_STATE_FAILED", record_id: record.id, details: { error: failureError.message } });
      }
    }

    const { data: accountDeletions, error: accountDeletionReadError } = await database.from("privacy_account_deletions").select("id,auth_user_id,email,status,attempts").in("status", ["PENDING", "FAILED"]).order("requested_at").limit(25);
    if (accountDeletionReadError) throw new Error(accountDeletionReadError.message);
    let deletedAccounts = 0;
    let accountDeletionFailures = 0;
    for (const accountDeletion of accountDeletions ?? []) {
      const { count, error: recordCountError } = await database.from("transaction_records").select("id", { head: true, count: "exact" }).eq("owner_user_id", accountDeletion.auth_user_id);
      if (recordCountError) throw new Error(recordCountError.message);
      if ((count ?? 0) > 0) continue;
      try {
        const { error: deleteUserError } = await database.auth.admin.deleteUser(accountDeletion.auth_user_id);
        if (deleteUserError && !/not found/i.test(deleteUserError.message)) throw new Error(deleteUserError.message);
        const { error: queueUpdateError } = await database.from("privacy_account_deletions").update({ status: "COMPLETED", completed_at: new Date().toISOString(), attempts: Number(accountDeletion.attempts ?? 0) + 1, last_error: null }).eq("id", accountDeletion.id);
        if (queueUpdateError) throw new Error(queueUpdateError.message);
        deletedAccounts += 1;
      } catch (cause) {
        accountDeletionFailures += 1;
        const message = cause instanceof Error ? cause.message : "Auth account deletion failed";
        await database.from("privacy_account_deletions").update({ status: "FAILED", attempts: Number(accountDeletion.attempts ?? 0) + 1, last_error: message.slice(0, 1_000) }).eq("id", accountDeletion.id);
        await database.from("operational_events").insert({ severity: "ERROR", service: "retention", event_type: "ACCOUNT_DELETION_FAILED", details: { queueId: accountDeletion.id, error: message.slice(0, 1_000) } });
      }
    }

    const { data: expiredPrivacy, error: privacyReadError } = await database.from("privacy_requests_v2").select("id").in("status", ["COMPLETED", "DENIED"]).lte("retention_until", now).limit(500);
    if (privacyReadError) throw new Error(privacyReadError.message);
    const privacyIds = (expiredPrivacy ?? []).map((item) => item.id);
    if (privacyIds.length > 0) {
      const { error } = await database.from("privacy_requests_v2").delete().in("id", privacyIds);
      if (error) throw new Error(error.message);
    }

    const { error: rateWindowError, count: deletedRateWindows } = await database.from("api_rate_windows").delete({ count: "exact" }).lte("expires_at", now);
    if (rateWindowError) throw new Error(rateWindowError.message);
    const { error: feedbackError, count: deletedFeedback } = await database.from("beta_feedback").delete({ count: "exact" }).lte("retention_until", now);
    if (feedbackError) throw new Error(feedbackError.message);
    const { error: notificationError, count: deletedNotifications } = await database.from("operator_notifications").delete({ count: "exact" }).lte("retention_until", now);
    if (notificationError) throw new Error(notificationError.message);
    const { error: eventError, count: deletedOperationalEvents } = await database.from("operational_events").delete({ count: "exact" }).lte("retention_until", now);
    if (eventError) throw new Error(eventError.message);
    const { error: operatorEventError, count: deletedOperatorEvents } = await database.from("operator_action_events").delete({ count: "exact" }).lte("retention_until", now);
    if (operatorEventError) throw new Error(operatorEventError.message);
    const { error: consentError, count: deletedConsentEvents } = await database.from("analysis_consent_events").delete({ count: "exact" }).lte("retention_until", now);
    if (consentError) throw new Error(consentError.message);
    const { error: productEventError, count: deletedProductEvents } = await database.from("product_events").delete({ count: "exact" }).lte("retention_until", now);
    if (productEventError) throw new Error(productEventError.message);
    const { error: maintenanceCleanupError, count: deletedMaintenanceRuns } = await database.from("maintenance_runs").delete({ count: "exact" }).lte("retention_until", now).neq("id", maintenanceRunId);
    if (maintenanceCleanupError) throw new Error(maintenanceCleanupError.message);
    const { error: oauthStateError, count: deletedOauthStates } = await database.from("stripe_oauth_states").delete({ count: "exact" }).lt("expires_at", now);
    if (oauthStateError) throw new Error(oauthStateError.message);
    const stripeEventCutoff = new Date(Date.now() - 4 * 365 * 24 * 60 * 60_000).toISOString();
    const { error: webhookEventError, count: deletedStripeEvents } = await database.from("stripe_webhook_events").delete({ count: "exact" }).lt("received_at", stripeEventCutoff);
    if (webhookEventError) throw new Error(webhookEventError.message);
    const notificationDelivery = await deliverPendingNotifications(20);
    const summary = { expiredJobs: Number(expiredJobs ?? 0), strandedInvoiceJobs: strandedInvoiceJobs?.length ?? 0, recoveredInvoices, deletedEvidence: deletedEvidenceCount, evidenceDeletionFailures, purgedRecords, recordDeletionFailures, deletedAccounts, accountDeletionFailures, deletedPrivacyRequests: privacyIds.length, deletedRateWindows: deletedRateWindows ?? 0, deletedFeedback: deletedFeedback ?? 0, deletedNotifications: deletedNotifications ?? 0, deletedOperationalEvents: deletedOperationalEvents ?? 0, deletedOperatorEvents: deletedOperatorEvents ?? 0, deletedConsentEvents: deletedConsentEvents ?? 0, deletedProductEvents: deletedProductEvents ?? 0, deletedMaintenanceRuns: deletedMaintenanceRuns ?? 0, deletedOauthStates: deletedOauthStates ?? 0, deletedStripeEvents: deletedStripeEvents ?? 0, notificationDelivery, processedAt: now };
    const { error: maintenanceCompleteError } = await database.from("maintenance_runs").update({ status: "SUCCEEDED", completed_at: new Date().toISOString(), summary }).eq("id", maintenanceRunId);
    if (maintenanceCompleteError) throw new Error(`Maintenance heartbeat could not complete: ${maintenanceCompleteError.message}`);
    return NextResponse.json({ ok: true, ...summary }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (maintenanceRunId !== null) await database.from("maintenance_runs").update({ status: "FAILED", completed_at: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 1_000) : "Retention maintenance failed" }).eq("id", maintenanceRunId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retention maintenance failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
