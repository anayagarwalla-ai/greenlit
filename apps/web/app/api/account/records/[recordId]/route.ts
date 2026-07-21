import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { getOptionalUser } from "@/lib/supabase-server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { sanitizeWorkspaceState } from "@/lib/workspace-state";

const patchSchema = z.object({
  workspaceState: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 1_000_000, "Workspace snapshot is too large."),
});

async function ownerRecord(recordId: string) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return { user: null, record: null };
  const database = requireSupabaseAdmin();
  const { data: record } = await database.from("transaction_records").select("*").eq("id", recordId).eq("owner_user_id", user.id).maybeSingle();
  return { user, record, database };
}

export async function GET(_request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  const owned = await ownerRecord(recordId);
  if (!owned.user) return NextResponse.json({ error: "Sign in with an invited account." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!owned.record || !owned.database) return NextResponse.json({ error: "This milestone was not found in your account." }, { status: 404, headers: noStoreJsonHeaders() });
  const database = owned.database;
  const [{ data: runs, error: runError }, { data: reviews, error: reviewError }] = await Promise.all([
    database.from("verification_jobs_v2").select("id, status, attempt, target_origin, build_url, build_label, checks, results, artifacts, browser_version, runner_version, manifest_sha256, last_error, started_at, completed_at, created_at").eq("record_id", recordId).order("created_at", { ascending: false }).limit(20),
    database.from("review_packets_v2").select("public_id, decision, reviewer_name, reviewer_email, reviewer_note, expires_at, revoked_at, decided_at, created_at").eq("record_id", recordId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (runError || reviewError) return NextResponse.json({ error: runError?.message ?? reviewError?.message }, { status: 503, headers: noStoreJsonHeaders() });
  const hydratedRuns = await Promise.all((runs ?? []).map(async (run) => ({
    ...run,
    artifacts: await Promise.all(((run.artifacts ?? []) as Array<Record<string, unknown>>).map(async (artifact) => {
      const storagePath = typeof artifact.storagePath === "string" ? artifact.storagePath : null;
      if (!storagePath) return artifact;
      const { data } = await database.storage.from("evidence").createSignedUrl(storagePath, 300);
      return { ...artifact, url: data?.signedUrl ?? null };
    })),
  })));
  return NextResponse.json({ record: owned.record, runs: hydratedRuns, reviews: reviews ?? [] }, { headers: noStoreJsonHeaders() });
}

export async function PATCH(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The workspace snapshot is invalid." }, { status: 422, headers: noStoreJsonHeaders() });
  const owned = await ownerRecord(recordId);
  if (!owned.user) return NextResponse.json({ error: "Sign in with an invited account." }, { status: 401, headers: noStoreJsonHeaders() });
  if (!owned.record || !owned.database) return NextResponse.json({ error: "This milestone was not found in your account." }, { status: 404, headers: noStoreJsonHeaders() });
  const { error } = await owned.database.from("transaction_records").update({ workspace_state: sanitizeWorkspaceState(parsed.data.workspaceState) }).eq("id", recordId).eq("owner_user_id", owned.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ saved: true }, { headers: noStoreJsonHeaders() });
}
