import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import {
  PRIVACY_ACCOUNT_DELETION_RECEIPT_DAYS,
  processPrivacyVerificationAccountCleanup,
  retentionRetryAt,
} from "@/lib/privacy-verification-cleanup";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

const UUID_PATH_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function evidenceJobIdFromStoragePath(path: string) {
  const [recordId, jobId, fileName, ...extra] = path.split("/");
  if (
    extra.length > 0
    || !fileName
    || !UUID_PATH_SEGMENT.test(recordId ?? "")
    || !UUID_PATH_SEGMENT.test(jobId ?? "")
  ) return null;
  return jobId;
}

export async function excludeRunningEvidenceAdoptions(
  database: ReturnType<typeof requireSupabaseAdmin>,
  paths: string[],
) {
  const jobIdByPath = new Map(
    paths.flatMap((path) => {
      const jobId = evidenceJobIdFromStoragePath(path);
      return jobId ? [[path, jobId] as const] : [];
    }),
  );
  const jobIds = [...new Set(jobIdByPath.values())];
  if (jobIds.length === 0) return paths;
  const { data, error } = await database.from("verification_jobs_v2")
    .select("id")
    .in("id", jobIds)
    .eq("status", "RUNNING");
  if (error) throw new Error(`Evidence adoption guard failed: ${error.message}`);
  const runningJobIds = new Set((data ?? []).map((job) => job.id));
  return paths.filter((path) => {
    const jobId = jobIdByPath.get(path);
    return !jobId || !runningJobIds.has(jobId);
  });
}

async function deleteOrphanedEvidence(database: ReturnType<typeof requireSupabaseAdmin>) {
  const knownPaths = new Set<string>();
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await database.from("evidence_artifacts_v2")
      .select("storage_path")
      .not("storage_path", "is", null)
      .range(offset, offset + 999);
    if (error) throw new Error(`Evidence metadata inventory failed: ${error.message}`);
    for (const row of data ?? []) if (row.storage_path) knownPaths.add(row.storage_path);
    if ((data ?? []).length < 1_000) break;
  }

  const cutoff = Date.now() - 60 * 60_000;
  const prefixes = [""];
  const candidates: string[] = [];
  let scanned = 0;
  while (prefixes.length > 0 && scanned < 1_000 && candidates.length < 100) {
    const prefix = prefixes.shift()!;
    for (let offset = 0; offset < 1_000 && scanned < 1_000; offset += 100) {
      const { data, error } = await database.storage.from("evidence").list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Evidence bucket inventory failed at ${prefix || "/"}: ${error.message}`);
      for (const item of data ?? []) {
        scanned += 1;
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        const isFile = Boolean(item.id || item.metadata);
        if (!isFile) {
          if (path.split("/").length < 3) prefixes.push(path);
          continue;
        }
        const createdAt = item.created_at ? new Date(item.created_at).getTime() : Number.NaN;
        if (!knownPaths.has(path) && Number.isFinite(createdAt) && createdAt < cutoff) candidates.push(path);
      }
      if ((data ?? []).length < 100) break;
    }
  }

  let deleted = 0;
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const batch = candidates.slice(offset, offset + 100);
    // Recheck metadata immediately before deletion to close the inventory race
    // with an evidence upload that commits while maintenance is scanning.
    const { data: nowTracked, error: recheckError } = await database.from("evidence_artifacts_v2")
      .select("storage_path")
      .in("storage_path", batch);
    if (recheckError) throw new Error(`Evidence orphan recheck failed: ${recheckError.message}`);
    const tracked = new Set((nowTracked ?? []).flatMap((item) => item.storage_path ? [item.storage_path] : []));
    const orphaned = batch.filter((path) => !tracked.has(path));
    if (orphaned.length === 0) continue;
    // An earlier upload may have received a storage 409 and still be adopting
    // this immutable object into metadata. RUNNING jobs own that adoption
    // window, so exclude their paths at the final deletion boundary.
    const removable = await excludeRunningEvidenceAdoptions(database, orphaned);
    if (removable.length === 0) continue;
    const { error: removeError } = await database.storage.from("evidence").remove(removable);
    if (removeError) throw new Error(`Orphaned evidence deletion failed: ${removeError.message}`);
    deleted += removable.length;
  }
  return { deleted, scanned, candidates: candidates.length };
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
    const { data: expiredJobs, error: staleJobError } = await database.rpc("expire_stale_verification_jobs_atomic", { p_stale_before: staleBefore, p_operator_email: "system:retention", p_limit: 50 });
    if (staleJobError) throw new Error(`Stale verification recovery failed: ${staleJobError.message}`);
    const { data: stagedEvidence, error: evidenceStageError } = await database.rpc("stage_expired_evidence_deletion", { p_limit: 50, p_now: now });
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
    let orphanedEvidence = { deleted: 0, scanned: 0, candidates: 0 };
    let orphanedEvidenceReconciliationFailures = 0;
    try {
      orphanedEvidence = await deleteOrphanedEvidence(database);
    } catch (cause) {
      orphanedEvidenceReconciliationFailures = 1;
      await database.from("operational_events").insert({
        severity: "ERROR",
        service: "retention",
        event_type: "ORPHANED_EVIDENCE_RECONCILIATION_FAILED",
        details: { error: cause instanceof Error ? cause.message.slice(0, 1_000) : "Orphaned evidence reconciliation failed" },
      });
    }

    const { data: expiredRecords, error: recordsError } = await database.rpc("stage_expired_record_deletion", { p_limit: 5, p_now: now });
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

    const { data: pendingAccountDeletions, error: pendingAccountDeletionReadError } = await database
      .from("privacy_account_deletions")
      .select("id,auth_user_id,status,attempts")
      .eq("status", "PENDING")
      .lte("next_attempt_at", now)
      .order("requested_at")
      .limit(5);
    if (pendingAccountDeletionReadError) throw new Error(pendingAccountDeletionReadError.message);
    const remainingAccountDeletionSlots = Math.max(0, 5 - (pendingAccountDeletions?.length ?? 0));
    const { data: failedAccountDeletions, error: failedAccountDeletionReadError } = remainingAccountDeletionSlots > 0
      ? await database
        .from("privacy_account_deletions")
        .select("id,auth_user_id,status,attempts")
        .eq("status", "FAILED")
        .lte("next_attempt_at", now)
        .order("next_attempt_at")
        .order("requested_at")
        .limit(remainingAccountDeletionSlots)
      : { data: [], error: null };
    if (failedAccountDeletionReadError) throw new Error(failedAccountDeletionReadError.message);
    const accountDeletions = [...(pendingAccountDeletions ?? []), ...(failedAccountDeletions ?? [])];
    let deletedAccounts = 0;
    let accountDeletionFailures = 0;
    for (const accountDeletion of accountDeletions) {
      const { count, error: recordCountError } = await database.from("transaction_records").select("id", { head: true, count: "exact" }).eq("owner_user_id", accountDeletion.auth_user_id);
      if (recordCountError) throw new Error(recordCountError.message);
      const attempts = Number(accountDeletion.attempts ?? 0) + 1;
      if ((count ?? 0) > 0) {
        const { error: deferError } = await database.from("privacy_account_deletions")
          .update({ attempts, next_attempt_at: retentionRetryAt(attempts) })
          .eq("id", accountDeletion.id);
        if (deferError) throw new Error(deferError.message);
        continue;
      }
      try {
        const { error: deleteUserError } = await database.auth.admin.deleteUser(accountDeletion.auth_user_id);
        if (deleteUserError && !/not found/i.test(deleteUserError.message)) throw new Error(deleteUserError.message);
        const completedAt = new Date();
        const { error: queueUpdateError } = await database.from("privacy_account_deletions").update({
          status: "COMPLETED",
          email: null,
          completed_at: completedAt.toISOString(),
          retention_until: new Date(completedAt.getTime() + PRIVACY_ACCOUNT_DELETION_RECEIPT_DAYS * 86_400_000).toISOString(),
          attempts,
          last_error: null,
        }).eq("id", accountDeletion.id);
        if (queueUpdateError) throw new Error(queueUpdateError.message);
        deletedAccounts += 1;
      } catch (cause) {
        accountDeletionFailures += 1;
        const message = cause instanceof Error ? cause.message : "Auth account deletion failed";
        await database.from("privacy_account_deletions").update({
          status: "FAILED",
          attempts,
          last_error: message.slice(0, 1_000),
          next_attempt_at: retentionRetryAt(attempts),
        }).eq("id", accountDeletion.id);
        await database.from("operational_events").insert({ severity: "ERROR", service: "retention", event_type: "ACCOUNT_DELETION_FAILED", details: { queueId: accountDeletion.id, error: message.slice(0, 1_000) } });
      }
    }

    const { data: pendingVerificationCleanups, error: pendingVerificationCleanupReadError } = await database
      .from("privacy_verification_account_cleanups")
      .select("id,auth_user_id,attempts")
      .eq("status", "PENDING")
      .lte("cleanup_after", now)
      .order("requested_at")
      .limit(5);
    if (pendingVerificationCleanupReadError) throw new Error(pendingVerificationCleanupReadError.message);
    const remainingVerificationCleanupSlots = Math.max(0, 5 - (pendingVerificationCleanups?.length ?? 0));
    const { data: failedVerificationCleanups, error: failedVerificationCleanupReadError } = remainingVerificationCleanupSlots > 0
      ? await database
        .from("privacy_verification_account_cleanups")
        .select("id,auth_user_id,attempts")
        .eq("status", "FAILED")
        .lte("cleanup_after", now)
        .order("cleanup_after")
        .order("requested_at")
        .limit(remainingVerificationCleanupSlots)
      : { data: [], error: null };
    if (failedVerificationCleanupReadError) throw new Error(failedVerificationCleanupReadError.message);
    const verificationAccountCleanups = [...(pendingVerificationCleanups ?? []), ...(failedVerificationCleanups ?? [])];
    let cleanedVerificationAccounts = 0;
    let preservedVerificationAccounts = 0;
    let verificationAccountCleanupFailures = 0;
    for (const cleanup of verificationAccountCleanups) {
      const result = await processPrivacyVerificationAccountCleanup(database, cleanup);
      if (!result.ok) {
        verificationAccountCleanupFailures += 1;
        await database.from("operational_events").insert({
          severity: "ERROR",
          service: "retention",
          event_type: "PRIVACY_VERIFICATION_ACCOUNT_CLEANUP_FAILED",
          details: { cleanupId: cleanup.id, error: result.error.slice(0, 1_000) },
        });
      } else if (result.disposition === "PRESERVED_ACTIVE_ACCOUNT") {
        preservedVerificationAccounts += 1;
      } else {
        cleanedVerificationAccounts += 1;
      }
    }

    const { data: privacyPurge, error: privacyPurgeError } = await database
      .rpc("purge_expired_privacy_requests_atomic", { p_now: now, p_limit: 500 });
    if (privacyPurgeError) throw new Error(privacyPurgeError.message);
    const privacyPurgeSummary = privacyPurge && typeof privacyPurge === "object"
      ? privacyPurge as { deletedCount?: unknown; overdueNonterminalCount?: unknown }
      : {};

    const { data: purgedDemoRequests, error: demoRequestPurgeError } = await database.rpc("purge_expired_demo_requests_atomic", { p_now: now, p_limit: 500 });
    if (demoRequestPurgeError) throw new Error(demoRequestPurgeError.message);
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
    const { data: deletedVerificationCleanupEvents, error: verificationCleanupPurgeError } = await database
      .rpc("purge_completed_privacy_verification_cleanups_atomic", { p_now: now, p_limit: 500 });
    if (verificationCleanupPurgeError) throw new Error(verificationCleanupPurgeError.message);
    const { error: accountDeletionPurgeError, count: deletedAccountDeletionReceipts } = await database
      .from("privacy_account_deletions")
      .delete({ count: "exact" })
      .eq("status", "COMPLETED")
      .lte("retention_until", now);
    if (accountDeletionPurgeError) throw new Error(accountDeletionPurgeError.message);
    const betaInviteMinimizeCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { error: betaInviteMinimizeError, count: minimizedBetaInviteTombstones } = await database
      .from("beta_invites")
      .update({
        adult_sponsor: null,
        invited_by: null,
        notes: null,
        last_sign_in_requested_at: null,
      }, { count: "exact" })
      .eq("status", "REMOVED")
      .lte("removed_at", betaInviteMinimizeCutoff)
      .or("adult_sponsor.not.is.null,invited_by.not.is.null,notes.not.is.null,last_sign_in_requested_at.not.is.null");
    if (betaInviteMinimizeError) throw new Error(betaInviteMinimizeError.message);
    const { error: betaInvitePurgeError, count: deletedBetaInviteTombstones } = await database
      .from("beta_invites")
      .delete({ count: "exact" })
      .eq("status", "REMOVED")
      .lte("retention_until", now);
    if (betaInvitePurgeError) throw new Error(betaInvitePurgeError.message);
    const { error: maintenanceCleanupError, count: deletedMaintenanceRuns } = await database.from("maintenance_runs").delete({ count: "exact" }).lte("retention_until", now).neq("id", maintenanceRunId);
    if (maintenanceCleanupError) throw new Error(maintenanceCleanupError.message);
    const { error: oauthStateError, count: deletedOauthStates } = await database.from("stripe_oauth_states").delete({ count: "exact" }).lt("expires_at", now);
    if (oauthStateError) throw new Error(oauthStateError.message);
    const stripeEventCutoff = new Date(Date.now() - 4 * 365 * 24 * 60 * 60_000).toISOString();
    const { error: webhookEventError, count: deletedStripeEvents } = await database.from("stripe_webhook_events").delete({ count: "exact" }).lt("received_at", stripeEventCutoff);
    if (webhookEventError) throw new Error(webhookEventError.message);
    const { error: stripeConnectionEventError, count: deletedStripeConnectionEvents } = await database
      .from("stripe_connection_events")
      .delete({ count: "exact" })
      .lte("retention_until", now);
    if (stripeConnectionEventError) throw new Error(stripeConnectionEventError.message);
    const summary = { expiredJobs: Number(expiredJobs ?? 0), deletedEvidence: deletedEvidenceCount, evidenceDeletionFailures, orphanedEvidenceDeleted: orphanedEvidence.deleted, orphanedEvidenceScanned: orphanedEvidence.scanned, orphanedEvidenceCandidates: orphanedEvidence.candidates, orphanedEvidenceReconciliationFailures, purgedRecords, recordDeletionFailures, deletedAccounts, accountDeletionFailures, cleanedVerificationAccounts, preservedVerificationAccounts, verificationAccountCleanupFailures, deletedVerificationCleanupEvents: Number(deletedVerificationCleanupEvents ?? 0), deletedAccountDeletionReceipts: deletedAccountDeletionReceipts ?? 0, minimizedBetaInviteTombstones: minimizedBetaInviteTombstones ?? 0, deletedBetaInviteTombstones: deletedBetaInviteTombstones ?? 0, deletedPrivacyRequests: Number(privacyPurgeSummary.deletedCount ?? 0), overdueNonterminalPrivacyRequests: Number(privacyPurgeSummary.overdueNonterminalCount ?? 0), deletedDemoRequests: Number(purgedDemoRequests ?? 0), deletedRateWindows: deletedRateWindows ?? 0, deletedFeedback: deletedFeedback ?? 0, deletedNotifications: deletedNotifications ?? 0, deletedOperationalEvents: deletedOperationalEvents ?? 0, deletedOperatorEvents: deletedOperatorEvents ?? 0, deletedConsentEvents: deletedConsentEvents ?? 0, deletedProductEvents: deletedProductEvents ?? 0, deletedMaintenanceRuns: deletedMaintenanceRuns ?? 0, deletedOauthStates: deletedOauthStates ?? 0, deletedStripeEvents: deletedStripeEvents ?? 0, deletedStripeConnectionEvents: deletedStripeConnectionEvents ?? 0, processedAt: now };
    const { error: maintenanceCompleteError } = await database.from("maintenance_runs").update({ status: "SUCCEEDED", completed_at: new Date().toISOString(), summary }).eq("id", maintenanceRunId);
    if (maintenanceCompleteError) throw new Error(`Maintenance heartbeat could not complete: ${maintenanceCompleteError.message}`);
    return NextResponse.json({ ok: true, ...summary }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (maintenanceRunId !== null) await database.from("maintenance_runs").update({ status: "FAILED", completed_at: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 1_000) : "Retention maintenance failed" }).eq("id", maintenanceRunId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retention maintenance failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
