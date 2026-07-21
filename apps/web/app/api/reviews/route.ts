import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { canonicalJson, noStoreJsonHeaders, publicRecordId, randomToken, requestActorHash, REVIEW_EXPIRY_HOURS, sha256 } from "@/lib/recordkeeping";
import { getOwnerIdentity } from "@/lib/owner-auth";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

const schema = z.object({ recordId: z.string().uuid(), runId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A completed record and run are required." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const owner = await getOwnerIdentity();
    if (!owner.userId && !owner.ownerTokenHash) return NextResponse.json({ error: "Sign in to create a client review." }, { status: 401, headers: noStoreJsonHeaders() });
    const quota = await consumeRateLimit(request, "review-packet-day", 20, 86_400, owner.userId ?? owner.ownerTokenHash);
    if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
    const { data: record, error: recordError } = await database.from("transaction_records").select("*").eq("id", parsed.data.recordId).single();
    const authorized = record && (record.owner_user_id === owner.userId || record.owner_token_hash === owner.ownerTokenHash);
    const { data: run, error: runError } = await database.from("verification_jobs_v2").select("*").eq("id", parsed.data.runId).eq("record_id", parsed.data.recordId).single();
    if (recordError || runError || !authorized || !run) return NextResponse.json({ error: "The passing verification record was not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const results: unknown[] = Array.isArray(run.results) ? run.results : [];
    const checks: Array<{ criterionId?: string }> = Array.isArray(run.checks) ? run.checks : [];
    const artifacts: Array<{ criterionId?: string; sha256?: string }> = Array.isArray(run.artifacts) ? run.artifacts : [];
    const resultIds = results.map((result) => (result as { criterionId?: string }).criterionId);
    const checkIds = checks.map((check) => check.criterionId);
    const completeCoverage = checks.length > 0 && results.length === checks.length && artifacts.length === checks.length && new Set(resultIds).size === checks.length && checkIds.every((id) => resultIds.includes(id) && artifacts.some((artifact) => artifact.criterionId === id && /^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")));
    if (run.status !== "COMPLETED" || !completeCoverage || !run.manifest_sha256 || results.some((result) => (result as { status?: string }).status !== "PASS")) return NextResponse.json({ error: "Only a complete passing run with matching stored evidence can be sent for review." }, { status: 409, headers: noStoreJsonHeaders() });

    const packetPublicId = publicRecordId("REVIEW");
    const token = randomToken();
    const expiresAt = new Date(Date.now() + REVIEW_EXPIRY_HOURS * 3_600_000).toISOString();
    const snapshot = {
      packetPublicId,
      recordId: record.id,
      recordPublicId: record.public_id,
      agencyName: record.agency_name,
      clientName: record.client_name,
      projectName: record.project_name,
      milestoneTitle: record.milestone_title,
      amountMinor: record.amount_minor,
      currency: record.currency,
      sourceName: record.source_name,
      sourceSha256: record.source_sha256,
      revision: record.revision,
      criteria: record.confirmed_criteria,
      run: { runId: run.id, buildLabel: run.build_label, buildUrl: run.build_url, results, artifacts: run.artifacts, browserVersion: run.browser_version, runnerVersion: run.runner_version, manifestSha256: run.manifest_sha256, startedAt: run.started_at, completedAt: run.completed_at },
      expiresAt,
    };
    const snapshotSha256 = sha256(canonicalJson(snapshot));
    const { error } = await database.rpc("create_review_packet_atomic", { p_record_id: record.id, p_run_id: run.id, p_public_id: packetPublicId, p_snapshot: snapshot, p_snapshot_sha256: snapshotSha256, p_bearer_token_hash: sha256(token), p_expires_at: expiresAt, p_actor_hash: requestActorHash(request) });
    if (error) throw new Error(`Review packet could not be recorded: ${error.message}`);
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    return NextResponse.json({ packetId: packetPublicId, reviewUrl: `${origin}/review/${packetPublicId}#t=${token}`, expiresAt, snapshotSha256 }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The client review could not be created." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
