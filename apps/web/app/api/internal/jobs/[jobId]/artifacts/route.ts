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
  base64: z.string().max(1_200_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  let body: string;
  try { body = await readLimitedBody(request, 1_300_000); }
  catch (error) { if (error instanceof RequestSizeError) return requestTooLargeResponse(error.maxBytes); throw error; }
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = schema.safeParse(JSON.parse(body));
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
    if (bytes.byteLength > 850_000) return NextResponse.json({ error: "Evidence screenshot exceeds the beta storage limit." }, { status: 413, headers: noStoreJsonHeaders() });
    if (sha256(bytes) !== parsed.data.sha256) return NextResponse.json({ error: "Evidence hash mismatch." }, { status: 422, headers: noStoreJsonHeaders() });
    const extension = parsed.data.mimeType === "image/jpeg" ? "jpg" : parsed.data.mimeType === "image/png" ? "png" : "json";
    const storagePath = `${job.record_id}/${jobId}/${parsed.data.criterionId}-${parsed.data.leaseId}-${parsed.data.kind.toLowerCase()}.${extension}`;
    const { error: uploadError } = await database.storage.from("evidence").upload(storagePath, bytes, { contentType: parsed.data.mimeType, upsert: true, cacheControl: "0" });
    if (uploadError) throw new Error(`Evidence upload failed: ${uploadError.message}`);
    const expiresAt = new Date(Date.now() + EVIDENCE_RETENTION_DAYS * 86_400_000).toISOString();
    const metadata = { criterionId: parsed.data.criterionId, kind: parsed.data.kind, mimeType: parsed.data.mimeType, byteSize: bytes.byteLength, sha256: parsed.data.sha256, storagePath, expiresAt };
    const { error: evidenceError } = await database.from("evidence_artifacts_v2").upsert({ record_id: job.record_id, run_id: jobId, criterion_id: parsed.data.criterionId, kind: parsed.data.kind, storage_path: storagePath, mime_type: parsed.data.mimeType, byte_size: bytes.byteLength, sha256: parsed.data.sha256, expires_at: expiresAt }, { onConflict: "run_id,criterion_id,kind" });
    if (evidenceError) throw new Error(`Evidence metadata could not be recorded: ${evidenceError.message}`);
    return NextResponse.json({ artifact: metadata }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (cause) {
    console.error("Evidence upload failed", cause instanceof Error ? cause.message : "unknown");
    return NextResponse.json({ error: "Evidence upload failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
