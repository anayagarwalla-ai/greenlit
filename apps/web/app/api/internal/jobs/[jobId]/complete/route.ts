import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { z } from "zod";
import { criterionResultSchema } from "@milestoneproof/contracts";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, canonicalJson, EVIDENCE_RETENTION_DAYS, noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";

const artifactSchema = z.object({
  criterionId: z.string().min(1).max(80),
  kind: z.enum(["SCREENSHOT", "NETWORK", "AXE", "MANIFEST"]),
  mimeType: z.string().min(1).max(100),
  base64: z.string().max(2_500_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const completionSchema = z.object({
  attempt: z.number().int().positive(),
  buildLabel: z.string().min(1).max(160),
  browserVersion: z.string().min(1).max(160),
  runnerVersion: z.string().min(1).max(80),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  results: z.array(criterionResultSchema).min(1).max(40),
  artifacts: z.array(artifactSchema).max(40),
});

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const body = await request.text();
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = completionSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return NextResponse.json({ error: "Invalid completion payload", issues: parsed.error.issues }, { status: 422, headers: noStoreJsonHeaders() });

  const { jobId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.from("verification_jobs_v2").select("id, record_id, status").eq("id", jobId).single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (job.status === "COMPLETED") return NextResponse.json({ jobId, accepted: true, status: "COMPLETED", duplicate: true }, { headers: noStoreJsonHeaders() });

    const artifactMetadata: Array<Record<string, unknown>> = [];
    const expiresAt = new Date(Date.now() + EVIDENCE_RETENTION_DAYS * 86_400_000).toISOString();
    for (const artifact of parsed.data.artifacts) {
      const bytes = Buffer.from(artifact.base64, "base64");
      if (sha256(bytes) !== artifact.sha256) throw new Error(`Evidence hash mismatch for ${artifact.criterionId}.`);
      const storagePath = `${job.record_id}/${jobId}/${artifact.criterionId}-${artifact.kind.toLowerCase()}.png`;
      const { error: uploadError } = await database.storage.from("evidence").upload(storagePath, bytes, { contentType: artifact.mimeType, upsert: true, cacheControl: "300" });
      if (uploadError) throw new Error(`Evidence upload failed: ${uploadError.message}`);
      const metadata = { criterionId: artifact.criterionId, kind: artifact.kind, mimeType: artifact.mimeType, byteSize: bytes.byteLength, sha256: artifact.sha256, storagePath, expiresAt };
      artifactMetadata.push(metadata);
      const { error: evidenceError } = await database.from("evidence_artifacts_v2").upsert({ record_id: job.record_id, run_id: jobId, criterion_id: artifact.criterionId, kind: artifact.kind, storage_path: storagePath, mime_type: artifact.mimeType, byte_size: bytes.byteLength, sha256: artifact.sha256, expires_at: expiresAt }, { onConflict: "run_id,criterion_id,kind" });
      if (evidenceError) throw new Error(`Evidence metadata could not be recorded: ${evidenceError.message}`);
    }

    const manifest = { results: parsed.data.results, artifacts: artifactMetadata.map(({ criterionId, kind, sha256: hash }) => ({ criterionId, kind, sha256: hash })) };
    const manifestSha256 = sha256(canonicalJson(manifest));
    const passing = parsed.data.results.every((result) => result.status === "PASS");
    const { error: updateError } = await database.from("verification_jobs_v2").update({
      status: "COMPLETED",
      attempt: parsed.data.attempt,
      results: parsed.data.results,
      artifacts: artifactMetadata,
      browser_version: parsed.data.browserVersion,
      runner_version: parsed.data.runnerVersion,
      manifest_sha256: manifestSha256,
      started_at: parsed.data.startedAt,
      completed_at: parsed.data.completedAt,
      last_error: null,
    }).eq("id", jobId);
    if (updateError) throw new Error(updateError.message);
    await database.from("transaction_records").update({ status: passing ? "READY_FOR_REVIEW" : "NEEDS_WORK" }).eq("id", job.record_id);
    await appendAuditEvent({ recordId: job.record_id, eventType: "VERIFICATION_COMPLETED", actorType: "RUNNER", payload: { jobId, outcome: passing ? "READY_FOR_REVIEW" : "NEEDS_WORK", resultCount: parsed.data.results.length, artifactCount: artifactMetadata.length, manifestSha256, completedAt: parsed.data.completedAt } });
    return NextResponse.json({ jobId, accepted: true, status: passing ? "READY_FOR_REVIEW" : "NEEDS_WORK", manifestSha256 }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Completion failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
