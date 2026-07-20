import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, canonicalJson, noStoreJsonHeaders, publicRecordId, randomToken, requestActorHash, REVIEW_EXPIRY_HOURS, sha256 } from "@/lib/recordkeeping";

const schema = z.object({ recordId: z.string().uuid(), runId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A completed record and run are required." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const ownerSession = (await cookies()).get("mp_owner")?.value;
    if (!ownerSession) return NextResponse.json({ error: "The milestone owner session has expired." }, { status: 401, headers: noStoreJsonHeaders() });
    const { data: record, error: recordError } = await database.from("transaction_records").select("*").eq("id", parsed.data.recordId).eq("owner_token_hash", sha256(ownerSession)).single();
    const { data: run, error: runError } = await database.from("verification_jobs_v2").select("*").eq("id", parsed.data.runId).eq("record_id", parsed.data.recordId).single();
    if (recordError || runError || !record || !run) return NextResponse.json({ error: "The passing verification record was not found." }, { status: 404, headers: noStoreJsonHeaders() });
    const results: unknown[] = Array.isArray(run.results) ? run.results : [];
    if (run.status !== "COMPLETED" || results.length === 0 || results.some((result) => (result as { status?: string }).status !== "PASS")) return NextResponse.json({ error: "Only a completed passing run can be sent for review." }, { status: 409, headers: noStoreJsonHeaders() });

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
    const { error } = await database.from("review_packets_v2").insert({ record_id: record.id, run_id: run.id, public_id: packetPublicId, snapshot, snapshot_sha256: snapshotSha256, bearer_token_hash: sha256(token), expires_at: expiresAt });
    if (error) throw new Error(`Review packet could not be recorded: ${error.message}`);
    await database.from("transaction_records").update({ status: "IN_REVIEW" }).eq("id", record.id);
    await appendAuditEvent({ recordId: record.id, eventType: "REVIEW_PACKET_CREATED", actorType: "OWNER", actorHash: requestActorHash(request), payload: { packetPublicId, runId: run.id, snapshotSha256, expiresAt } });
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    return NextResponse.json({ packetId: packetPublicId, reviewUrl: `${origin}/review/${packetPublicId}#t=${token}`, expiresAt, snapshotSha256 }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The client review could not be created." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
