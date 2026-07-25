import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOwnerIdentity } from "@/lib/owner-auth";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { betaAccessAllowedFresh } from "@/lib/beta-access";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  try {
    const owner = await getOwnerIdentity();
    if (!owner.userId) return NextResponse.json({ error: "Sign in to access this verification run." }, { status: 401, headers: noStoreJsonHeaders() });
    if (!owner.user || !await betaAccessAllowedFresh(owner.user)) return NextResponse.json({ error: "This account is no longer on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
    const database = requireSupabaseAdmin();
    const runLookup = await database.from("verification_jobs_v2")
      .select("id, record_id, status, build_url, build_label, results, artifacts, browser_version, runner_version, manifest_sha256, last_error, started_at, leased_at, completed_at, created_at")
      .eq("id", runId)
      .single();
    let run = runLookup.data;
    if (runLookup.error || !run) return NextResponse.json({ error: "Verification run not found." }, { status: 404, headers: noStoreJsonHeaders() });

    let { data: record } = await database.from("transaction_records")
      .select("public_id, owner_user_id, agency_name, client_name, project_name, milestone_title, amount_minor, currency, source_name, source_sha256, confirmed_criteria, criteria_revision, status")
      .eq("id", run.record_id)
      .single();
    if (!record || record.owner_user_id !== owner.userId) return NextResponse.json({ error: "This account cannot access the run." }, { status: 403, headers: noStoreJsonHeaders() });

    if (["QUEUED", "LEASED", "RUNNING"].includes(run.status)) {
      const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data: expired, error: recoveryError } = await database.rpc("expire_owned_stale_verification_job_atomic", {
        p_job_id: run.id,
        p_owner_user_id: owner.userId,
        p_stale_before: staleBefore,
      });
      if (recoveryError) throw new Error(`Stale verification recovery failed: ${recoveryError.message}`);
      if (expired) {
        const [refreshedRun, refreshedRecord] = await Promise.all([
          database.from("verification_jobs_v2")
            .select("id, record_id, status, build_url, build_label, results, artifacts, browser_version, runner_version, manifest_sha256, last_error, started_at, leased_at, completed_at, created_at")
            .eq("id", runId).single(),
          database.from("transaction_records")
            .select("public_id, owner_user_id, agency_name, client_name, project_name, milestone_title, amount_minor, currency, source_name, source_sha256, confirmed_criteria, criteria_revision, status")
            .eq("id", run.record_id).single(),
        ]);
        if (refreshedRun.error || !refreshedRun.data || refreshedRecord.error || !refreshedRecord.data) throw new Error("Recovered verification state could not be refreshed.");
        run = refreshedRun.data;
        record = refreshedRecord.data;
      }
    }

    const artifacts = await Promise.all(((run.artifacts ?? []) as Array<Record<string, unknown>>).map(async (artifact) => {
      const storagePath = typeof artifact.storagePath === "string" ? artifact.storagePath : null;
      if (!storagePath) return artifact;
      const { data } = await database.storage.from("evidence").createSignedUrl(storagePath, 60);
      return { ...artifact, url: data?.signedUrl ?? null };
    }));

    const results = Array.isArray(run.results) ? run.results : [];
    const completed = run.status === "COMPLETED";
    const passing = completed && results.length > 0 && results.every((result) => result && typeof result === "object" && (result as { status?: string }).status === "PASS");
    return NextResponse.json({
      runId: run.id,
      recordId: run.record_id,
      status: run.status,
      outcome: completed ? (passing ? "READY_FOR_REVIEW" : "NEEDS_WORK") : null,
      buildUrl: run.build_url,
      buildLabel: run.build_label,
      results,
      artifacts,
      browserVersion: run.browser_version,
      runnerVersion: run.runner_version,
      manifestSha256: run.manifest_sha256,
      error: run.last_error,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      createdAt: run.created_at,
      record: { ...record, revision: record.criteria_revision },
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    console.error("Verification status lookup failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Verification status is temporarily unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
