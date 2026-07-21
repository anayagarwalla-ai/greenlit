import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { deliverPendingNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Retention maintenance is not configured." }, { status: 503, headers: noStoreJsonHeaders() });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });

  try {
    const database = requireSupabaseAdmin();
    const now = new Date().toISOString();
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
        if (failureError) throw new Error(`Evidence deletion failed and its retry state could not be recorded: ${failureError.message}`);
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
        if (failureError) throw new Error(`Record deletion failed and its retry state could not be recorded: ${failureError.message}`);
      }
    }

    const { data: expiredPrivacy, error: privacyReadError } = await database.from("privacy_requests_v2").select("id").lte("retention_until", now).limit(500);
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
    const notificationDelivery = await deliverPendingNotifications(20);

    return NextResponse.json({ ok: true, deletedEvidence: deletedEvidenceCount, evidenceDeletionFailures, purgedRecords, recordDeletionFailures, deletedPrivacyRequests: privacyIds.length, deletedRateWindows: deletedRateWindows ?? 0, deletedFeedback: deletedFeedback ?? 0, deletedNotifications: deletedNotifications ?? 0, deletedOperationalEvents: deletedOperationalEvents ?? 0, notificationDelivery, processedAt: now }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retention maintenance failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
