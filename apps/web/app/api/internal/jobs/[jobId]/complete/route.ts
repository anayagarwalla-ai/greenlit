import { NextResponse } from "next/server";
import { z } from "zod";
import { criterionResultSchema } from "@greenlit/contracts";
import { verifyRunnerRequest } from "@/lib/hmac";
import { requireSupabaseAdmin } from "@/lib/database";
import { canonicalJson, noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { readLimitedBody, RequestSizeError, requestTooLargeResponse } from "@/lib/request-security";
import { logProductEvent } from "@/lib/operations";

const artifactSchema = z.object({
  criterionId: z.string().min(1).max(80),
  kind: z.enum(["SCREENSHOT", "NETWORK", "AXE", "MANIFEST"]),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
  storagePath: z.string().min(1).max(500),
  expiresAt: z.string().datetime(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const completionSchema = z.object({
  attempt: z.number().int().positive(),
  leaseId: z.string().uuid(),
  buildLabel: z.string().min(1).max(160),
  browserVersion: z.string().min(1).max(160),
  runnerVersion: z.string().min(1).max(80),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  results: z.array(criterionResultSchema).min(1).max(6),
  artifacts: z.array(artifactSchema).max(6),
});

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  let body: string;
  try { body = await readLimitedBody(request, 160_000); }
  catch (error) { if (error instanceof RequestSizeError) return requestTooLargeResponse(error.maxBytes); throw error; }
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!secret || !await verifyRunnerRequest(body, secret, request.headers.get("x-mp-timestamp"), request.headers.get("x-mp-signature"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = completionSchema.safeParse((() => { try { return JSON.parse(body); } catch { return null; } })());
  if (!parsed.success) return NextResponse.json({ error: "Invalid completion payload", issues: parsed.error.issues }, { status: 422, headers: noStoreJsonHeaders() });

  const { jobId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: job, error } = await database.from("verification_jobs_v2").select("id, record_id, status, checks, runner_version").eq("id", jobId).single();
    if (error || !job) return NextResponse.json({ error: "Job not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (!job.runner_version || parsed.data.runnerVersion !== job.runner_version) {
      return NextResponse.json({ error: "The runner version does not match the version frozen for this job." }, { status: 409, headers: noStoreJsonHeaders() });
    }
    const artifactMetadata = parsed.data.artifacts;
    const checks = (job.checks ?? []) as Array<{ criterionId?: string }>;
    const checkIds = checks.map((check) => check.criterionId).filter((id): id is string => Boolean(id));
    const resultIds = parsed.data.results.map((result) => result.criterionId);
    const artifactIds = artifactMetadata.map((artifact) => artifact.criterionId);
    const exactlyMatches = (values: string[]) => values.length === checkIds.length && new Set(values).size === checkIds.length && checkIds.every((id) => values.includes(id));
    if (!exactlyMatches(resultIds)) return NextResponse.json({ error: "Every frozen check must have exactly one matching result." }, { status: 422, headers: noStoreJsonHeaders() });
    if (!exactlyMatches(artifactIds)) return NextResponse.json({ error: "Every frozen check must have exactly one matching evidence artifact." }, { status: 422, headers: noStoreJsonHeaders() });
    const { data: storedArtifacts, error: evidenceError } = await database.from("evidence_artifacts_v2").select("criterion_id, kind, storage_path, byte_size, sha256").eq("run_id", jobId);
    if (evidenceError) throw new Error(evidenceError.message);
    if ((storedArtifacts ?? []).length !== artifactMetadata.length || artifactMetadata.some((artifact) => !(storedArtifacts ?? []).some((stored) => stored.criterion_id === artifact.criterionId && stored.kind === artifact.kind && stored.storage_path === artifact.storagePath && stored.byte_size === artifact.byteSize && stored.sha256 === artifact.sha256))) {
      return NextResponse.json({ error: "Evidence metadata does not match private storage records." }, { status: 422, headers: noStoreJsonHeaders() });
    }
    if (parsed.data.results.some((result) => {
      const artifact = artifactMetadata.find((item) => item.criterionId === result.criterionId);
      return !artifact || result.evidenceHash !== artifact.sha256 || result.evidenceId !== artifact.storagePath;
    })) return NextResponse.json({ error: "Result evidence references do not match the stored artifact manifest." }, { status: 422, headers: noStoreJsonHeaders() });

    const manifest = { results: parsed.data.results, artifacts: artifactMetadata.map(({ criterionId, kind, sha256: hash }) => ({ criterionId, kind, sha256: hash })) };
    const manifestSha256 = sha256(canonicalJson(manifest));
    const { data: outcome, error: completionError } = await database.rpc("complete_verification_job_atomic", { p_job_id: jobId, p_attempt: parsed.data.attempt, p_lease_id: parsed.data.leaseId, p_results: parsed.data.results, p_artifacts: artifactMetadata, p_browser_version: parsed.data.browserVersion, p_runner_version: parsed.data.runnerVersion, p_manifest_sha256: manifestSha256, p_started_at: parsed.data.startedAt, p_completed_at: parsed.data.completedAt });
    if (completionError) throw new Error(completionError.message);
    if (outcome !== "DUPLICATE") {
      const durationMs = new Date(parsed.data.completedAt).getTime() - new Date(parsed.data.startedAt).getTime();
      const durationBucket = durationMs < 30_000 ? "under-30s" : durationMs < 60_000 ? "30-60s" : "over-60s";
      await logProductEvent({
        eventType: "VERIFICATION_COMPLETED",
        recordId: job.record_id,
        properties: {
          status: parsed.data.results.every((result) => result.status === "PASS") ? "PASSED" : "NEEDS_WORK",
          resultCount: parsed.data.results.length,
          durationBucket,
        },
      });
    }
    return NextResponse.json({ jobId, accepted: true, status: outcome === "DUPLICATE" ? "COMPLETED" : outcome, manifestSha256, duplicate: outcome === "DUPLICATE" }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Runner completion callback failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Completion failed." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
