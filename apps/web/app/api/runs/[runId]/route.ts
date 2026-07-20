import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: run, error } = await database.from("verification_jobs_v2")
      .select("id, record_id, status, build_url, build_label, results, artifacts, browser_version, runner_version, manifest_sha256, last_error, started_at, completed_at, created_at")
      .eq("id", runId)
      .single();
    if (error || !run) return NextResponse.json({ error: "Verification run not found." }, { status: 404, headers: noStoreJsonHeaders() });

    const ownerSession = (await cookies()).get("mp_owner")?.value;
    if (!ownerSession) return NextResponse.json({ error: "The milestone owner session has expired." }, { status: 401, headers: noStoreJsonHeaders() });
    const { data: record } = await database.from("transaction_records")
      .select("public_id, agency_name, client_name, project_name, milestone_title, amount_minor, currency, source_name, source_sha256, confirmed_criteria, revision, status")
      .eq("id", run.record_id)
      .eq("owner_token_hash", sha256(ownerSession))
      .single();
    if (!record) return NextResponse.json({ error: "This owner session cannot access the run." }, { status: 403, headers: noStoreJsonHeaders() });

    const artifacts = await Promise.all(((run.artifacts ?? []) as Array<Record<string, unknown>>).map(async (artifact) => {
      const storagePath = typeof artifact.storagePath === "string" ? artifact.storagePath : null;
      if (!storagePath) return artifact;
      const { data } = await database.storage.from("evidence").createSignedUrl(storagePath, 300);
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
      record,
    }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Verification status is unavailable." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
