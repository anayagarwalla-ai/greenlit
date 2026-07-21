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
    const { data: expiredEvidence, error: evidenceReadError } = await database.from("evidence_artifacts_v2")
      .select("id, record_id, storage_path")
      .lte("expires_at", now)
      .eq("legal_hold", false)
      .limit(500);
    if (evidenceReadError) throw new Error(evidenceReadError.message);

    // Group by record so storage removal + the DB delete + its audit event
    // all happen per-record: storage is only ever removed for artifacts we
    // are about to (and then atomically do) delete from the database.
    const byRecord = new Map<string, Array<{ id: string; storage_path: string | null }>>();
    for (const item of expiredEvidence ?? []) byRecord.set(item.record_id, [...(byRecord.get(item.record_id) ?? []), { id: item.id, storage_path: item.storage_path }]);
    let deletedEvidenceCount = 0;
    for (const [recordId, items] of byRecord) {
      const paths = items.flatMap((item) => item.storage_path ? [item.storage_path] : []);
      if (paths.length > 0) {
        const { error } = await database.storage.from("evidence").remove(paths);
        if (error) throw new Error(`Expired evidence could not be removed: ${error.message}`);
      }
      const { data: purgedCount, error: purgeError } = await database.rpc("purge_expired_evidence_atomic", { p_ids: items.map((item) => item.id), p_record_id: recordId, p_processed_at: now });
      if (purgeError) throw new Error(purgeError.message);
      deletedEvidenceCount += Number(purgedCount ?? 0);
    }

    const { data: expiredRecords, error: recordsError } = await database.from("transaction_records")
      .select("id")
      .lte("retention_until", now)
      .eq("legal_hold", false)
      .limit(50);
    if (recordsError) throw new Error(recordsError.message);
    let purgedRecords = 0;
    for (const record of expiredRecords ?? []) {
      // A hold on ANY of this record's evidence artifacts must protect the
      // artifact's storage file, not just the database row — check before
      // removing anything from Storage. purge_expired_transaction_record
      // re-checks holds on the DB side before deleting, but by the time it
      // ran the storage files would already be gone if we didn't check here.
      const { data: heldArtifacts } = await database.from("evidence_artifacts_v2").select("id").eq("record_id", record.id).eq("legal_hold", true).limit(1);
      if ((heldArtifacts ?? []).length > 0) continue;
      const { data: remainingArtifacts } = await database.from("evidence_artifacts_v2").select("storage_path").eq("record_id", record.id);
      const paths = (remainingArtifacts ?? []).flatMap((item) => item.storage_path ? [item.storage_path] : []);
      if (paths.length > 0) {
        const { error } = await database.storage.from("evidence").remove(paths);
        if (error) throw new Error(`Record evidence could not be removed: ${error.message}`);
      }
      const { data, error } = await database.rpc("purge_expired_transaction_record", { p_record_id: record.id });
      if (error) throw new Error(error.message);
      if (data === true) purgedRecords += 1;
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

    return NextResponse.json({ ok: true, deletedEvidence: deletedEvidenceCount, purgedRecords, deletedPrivacyRequests: privacyIds.length, deletedRateWindows: deletedRateWindows ?? 0, deletedFeedback: deletedFeedback ?? 0, deletedNotifications: deletedNotifications ?? 0, deletedOperationalEvents: deletedOperationalEvents ?? 0, notificationDelivery, processedAt: now }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retention maintenance failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
