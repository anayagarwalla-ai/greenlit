import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { EVIDENCE_RETENTION_DAYS, noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { readLimitedBody, RequestSizeError, requestTooLargeResponse } from "@/lib/request-security";

const schema = z.object({
  leaseId: z.string().uuid(),
  criterionId: z.string().min(1).max(80),
  kind: z.enum(["SCREENSHOT", "NETWORK", "AXE", "MANIFEST"]),
  mimeType: z.enum(["image/jpeg", "image/png", "application/json"]),
  base64: z.string().min(4).max(1_200_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => value.length % 4 === 0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

function isExistingStorageObject(error: unknown) {
  const value = error as { message?: string; statusCode?: string | number } | null;
  return value?.statusCode === 409
    || value?.statusCode === "409"
    || /already exists|duplicate/i.test(value?.message ?? "");
}

type EvidenceRpcError = { message?: string | null; details?: string | null };

function evidenceRejectionCode(error: EvidenceRpcError | null | undefined) {
  const stableDetails = new Set([
    "EVIDENCE_JOB_NOT_FOUND",
    "STALE_EVIDENCE_LEASE",
    "EVIDENCE_CRITERION_MISMATCH",
    "EVIDENCE_METADATA_INVALID",
    "EVIDENCE_SLOT_CONFLICT",
  ]);
  if (error?.details && stableDetails.has(error.details)) return error.details;
  const fallbackByMessage: Record<string, string> = {
    "Verification job not found": "EVIDENCE_JOB_NOT_FOUND",
    "Evidence belongs to an inactive or stale verification lease": "STALE_EVIDENCE_LEASE",
    "Evidence criterion is not in the frozen check manifest": "EVIDENCE_CRITERION_MISMATCH",
    "Evidence metadata is invalid": "EVIDENCE_METADATA_INVALID",
    "Evidence slot is already frozen with different content": "EVIDENCE_SLOT_CONFLICT",
  };
  return error?.message ? fallbackByMessage[error.message] : undefined;
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  let body: string;
  try { body = await readLimitedBody(request, 1_300_000); }
  catch (error) { if (error instanceof RequestSizeError) return requestTooLargeResponse(error.maxBytes); throw error; }
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = schema.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ error: "Invalid evidence artifact." }, { status: 422, headers: noStoreJsonHeaders() });
  const { jobId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.from("verification_jobs_v2").select("id, record_id, status, checks, lease_id").eq("id", jobId).single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (job.status !== "RUNNING") return NextResponse.json({ error: `Evidence is not accepted for a ${job.status} job.` }, { status: 409, headers: noStoreJsonHeaders() });
    if (job.lease_id !== parsed.data.leaseId) return NextResponse.json({ error: "This evidence upload belongs to a stale or replayed runner lease." }, { status: 409, headers: noStoreJsonHeaders() });
    const checkIds = new Set(((job.checks ?? []) as Array<{ criterionId?: string }>).map((check) => check.criterionId));
    if (!checkIds.has(parsed.data.criterionId)) return NextResponse.json({ error: "Artifact criterion is not in the frozen check manifest." }, { status: 422, headers: noStoreJsonHeaders() });
    const bytes = Buffer.from(parsed.data.base64, "base64");
    if (bytes.byteLength === 0) return NextResponse.json({ error: "Evidence artifact is empty." }, { status: 422, headers: noStoreJsonHeaders() });
    if (bytes.byteLength > 850_000) return NextResponse.json({ error: "Evidence screenshot exceeds the beta storage limit." }, { status: 413, headers: noStoreJsonHeaders() });
    if (sha256(bytes) !== parsed.data.sha256) return NextResponse.json({ error: "Evidence hash mismatch." }, { status: 422, headers: noStoreJsonHeaders() });
    const extension = parsed.data.mimeType === "image/jpeg" ? "jpg" : parsed.data.mimeType === "image/png" ? "png" : "json";
    const safeCriterionId = encodeURIComponent(parsed.data.criterionId);
    const storagePath = `${job.record_id}/${jobId}/${safeCriterionId}-${parsed.data.leaseId}-${parsed.data.kind.toLowerCase()}-${parsed.data.sha256}.${extension}`;
    const { error: uploadError } = await database.storage.from("evidence").upload(storagePath, bytes, { contentType: parsed.data.mimeType, upsert: false, cacheControl: "0" });
    const uploadedNewObject = !uploadError;
    if (uploadError && !isExistingStorageObject(uploadError)) throw new Error(`Evidence upload failed: ${uploadError.message}`);
    const requestedExpiresAt = new Date(Date.now() + EVIDENCE_RETENTION_DAYS * 86_400_000).toISOString();
    const { data: evidenceResult, error: evidenceError } = await database.rpc("record_evidence_artifact_atomic", {
      p_job_id: jobId,
      p_lease_id: parsed.data.leaseId,
      p_criterion_id: parsed.data.criterionId,
      p_kind: parsed.data.kind,
      p_storage_path: storagePath,
      p_mime_type: parsed.data.mimeType,
      p_byte_size: bytes.byteLength,
      p_sha256: parsed.data.sha256,
      p_expires_at: requestedExpiresAt,
    });
    if (evidenceError) {
      const rejectionCode = evidenceRejectionCode(evidenceError);
      if (!rejectionCode) {
        throw new Error(`Evidence registration failed: ${evidenceError.message ?? "unknown database error"}`);
      }
      if (uploadedNewObject) {
        const { data: adoptedArtifact, error: adoptionError } = await database
          .from("evidence_artifacts_v2")
          .select("id")
          .eq("storage_path", storagePath)
          .limit(1)
          .maybeSingle();
        if (adoptionError) {
          console.error("Uncommitted evidence ownership check failed", storagePath, adoptionError.message);
        } else if (!adoptedArtifact) {
          const { error: cleanupError } = await database.storage.from("evidence").remove([storagePath]);
          if (cleanupError) console.error("Uncommitted evidence cleanup failed", storagePath, cleanupError.message);
        }
      }
      return NextResponse.json(
        { error: "Evidence is no longer accepted for this runner lease.", code: rejectionCode },
        { status: 409, headers: noStoreJsonHeaders() },
      );
    }
    const duplicate = evidenceResult === "DUPLICATE";
    let expiresAt = requestedExpiresAt;
    if (duplicate) {
      const { data: storedArtifact, error: storedArtifactError } = await database
        .from("evidence_artifacts_v2")
        .select("expires_at")
        .eq("run_id", jobId)
        .eq("criterion_id", parsed.data.criterionId)
        .eq("kind", parsed.data.kind)
        .single();
      if (storedArtifactError || !storedArtifact) throw new Error("Recorded evidence metadata could not be confirmed.");
      const canonicalExpiresAt = new Date(storedArtifact.expires_at);
      if (!Number.isFinite(canonicalExpiresAt.valueOf())) throw new Error("Recorded evidence expiry is invalid.");
      expiresAt = canonicalExpiresAt.toISOString();
    }
    const metadata = {
      criterionId: parsed.data.criterionId,
      kind: parsed.data.kind,
      mimeType: parsed.data.mimeType,
      byteSize: bytes.byteLength,
      sha256: parsed.data.sha256,
      storagePath,
      expiresAt,
    };
    return NextResponse.json(
      { artifact: metadata, duplicate },
      { status: duplicate ? 200 : 201, headers: noStoreJsonHeaders() },
    );
  } catch (cause) {
    console.error("Evidence upload failed", cause instanceof Error ? cause.message : "unknown");
    return NextResponse.json({ error: "Evidence upload failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
