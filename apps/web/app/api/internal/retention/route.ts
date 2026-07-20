import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, noStoreJsonHeaders } from "@/lib/recordkeeping";

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

    const evidencePaths = (expiredEvidence ?? []).flatMap((item) => item.storage_path ? [item.storage_path] : []);
    if (evidencePaths.length > 0) {
      const { error } = await database.storage.from("evidence").remove(evidencePaths);
      if (error) throw new Error(`Expired evidence could not be removed: ${error.message}`);
    }
    const evidenceIds = (expiredEvidence ?? []).map((item) => item.id);
    if (evidenceIds.length > 0) {
      const { error } = await database.from("evidence_artifacts_v2").delete().in("id", evidenceIds);
      if (error) throw new Error(error.message);
      const byRecord = new Map<string, number>();
      for (const item of expiredEvidence ?? []) byRecord.set(item.record_id, (byRecord.get(item.record_id) ?? 0) + 1);
      for (const [recordId, count] of byRecord) await appendAuditEvent({ recordId, eventType: "EVIDENCE_RETENTION_EXPIRED", actorType: "SYSTEM", payload: { deletedArtifactCount: count, processedAt: now } });
    }

    const { data: expiredRecords, error: recordsError } = await database.from("transaction_records")
      .select("id")
      .lte("retention_until", now)
      .eq("legal_hold", false)
      .limit(50);
    if (recordsError) throw new Error(recordsError.message);
    let purgedRecords = 0;
    for (const record of expiredRecords ?? []) {
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

    return NextResponse.json({ ok: true, deletedEvidence: evidenceIds.length, purgedRecords, deletedPrivacyRequests: privacyIds.length, processedAt: now }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retention maintenance failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
