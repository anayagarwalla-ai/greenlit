import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { signRunnerRequest } from "@/lib/hmac";
import { fixtureChecks } from "@/lib/demo-checks";
import { demoCriteria, demoMilestone } from "@/lib/demo";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, canonicalJson, noStoreJsonHeaders, publicRecordId, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";

export const runtime = "nodejs";

const criterionSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  sourceQuote: z.string().min(3).max(1_000),
});

const schema = z.object({
  recordId: z.string().uuid().optional(),
  version: z.enum(["rc1", "rc2"]),
  sourceMode: z.enum(["demo", "live"]),
  sourceName: z.string().min(1).max(240),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  agencyName: z.string().min(1).max(120),
  clientName: z.string().min(1).max(120),
  projectName: z.string().min(1).max(180),
  milestoneTitle: z.string().min(1).max(180),
  amountMinor: z.number().int().min(0).max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  criteria: z.array(criterionSchema).min(1).max(40),
  ownerTermsAccepted: z.literal(true),
  noticeVersion: z.literal(RECORD_NOTICE_VERSION),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The verified run request is incomplete.", issues: parsed.error.issues }, { status: 422, headers: noStoreJsonHeaders() });

  const runnerUrl = process.env.RUNNER_URL;
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (!runnerUrl || !secret) return NextResponse.json({ error: "The verification runner is not configured. Use the guided walkthrough while the runner is restored." }, { status: 503, headers: noStoreJsonHeaders() });

  try {
    const database = requireSupabaseAdmin();
    const actorHash = requestActorHash(request);
    const body = parsed.data;
    const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    const checks = fixtureChecks(body.version);
    const sourceHash = body.sourceSha256;
    const criteriaHash = sha256(canonicalJson(body.criteria));
    let recordId = body.recordId;
    let recordPublicId: string;
    let ownerToken: string | null = null;

    if (recordId) {
      const ownerSession = (await cookies()).get("mp_owner")?.value;
      if (!ownerSession) return NextResponse.json({ error: "The milestone owner session has expired. Start a new import." }, { status: 401, headers: noStoreJsonHeaders() });
      const { data: record, error } = await database.from("transaction_records").select("id, public_id").eq("id", recordId).eq("owner_token_hash", sha256(ownerSession)).single();
      if (error || !record) return NextResponse.json({ error: "The milestone record no longer exists." }, { status: 404, headers: noStoreJsonHeaders() });
      recordPublicId = record.public_id;
    } else {
      recordPublicId = publicRecordId("MP");
      ownerToken = randomToken();
      const { data: record, error } = await database.from("transaction_records").insert({
        public_id: recordPublicId,
        owner_token_hash: sha256(ownerToken),
        mode: body.sourceMode === "demo" ? "GUIDED_DEMO" : "IMPORTED_FIXTURE",
        agency_name: body.agencyName,
        client_name: body.clientName,
        project_name: body.projectName,
        milestone_title: body.milestoneTitle,
        amount_minor: body.amountMinor,
        currency: body.currency,
        source_name: body.sourceName,
        source_sha256: sourceHash,
        confirmed_criteria: body.criteria,
        target_origin: appOrigin,
        status: "READY",
      }).select("id").single();
      if (error || !record) throw new Error(`Milestone record could not be created: ${error?.message ?? "unknown error"}`);
      recordId = record.id;
      try {
        await appendAuditEvent({ recordId: record.id, eventType: "MILESTONE_FROZEN", actorType: "OWNER", actorHash, payload: { publicId: recordPublicId, revision: 1, sourceSha256: sourceHash, criteriaSha256: criteriaHash, criteriaCount: body.criteria.length, criteriaConfirmedByOwner: true, ownerTermsAccepted: true, noticeVersion: body.noticeVersion } });
      } catch (auditError) {
        // A record without its first audit event is not a valid transaction.
        // This exact, childless setup row is safe to remove; if the event was
        // actually committed, the audit-event foreign key prevents deletion.
        await database.from("transaction_records").delete().eq("id", record.id);
        throw auditError;
      }
    }

    const durableRecordId = recordId;
    if (!durableRecordId) throw new Error("The milestone record identifier is missing.");

    const { data: job, error: jobError } = await database.from("verification_jobs_v2").insert({
      record_id: durableRecordId,
      status: "QUEUED",
      target_origin: appOrigin,
      build_url: `${appOrigin}/fixture/${body.version}`,
      build_label: `launch-${body.version}`,
      checks,
      runner_version: "0.4.0",
    }).select("id").single();
    if (jobError || !job) throw new Error(`Verification job could not be recorded: ${jobError?.message ?? "unknown error"}`);

    await database.from("transaction_records").update({ status: "VERIFYING" }).eq("id", durableRecordId);
    await appendAuditEvent({ recordId: durableRecordId, eventType: "VERIFICATION_QUEUED", actorType: "OWNER", actorHash, payload: { jobId: job.id, buildLabel: `launch-${body.version}`, checkCount: checks.length } });

    const payload = JSON.stringify({ jobId: job.id });
    const signed = await signRunnerRequest(payload, secret);
    const dispatched = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature },
      body: payload,
    });
    if (!dispatched.ok) {
      await database.from("verification_jobs_v2").update({ status: "FAILED", last_error: `Dispatch returned ${dispatched.status}`, completed_at: new Date().toISOString() }).eq("id", job.id);
      await database.from("transaction_records").update({ status: "READY" }).eq("id", durableRecordId);
      await appendAuditEvent({ recordId: durableRecordId, eventType: "VERIFICATION_DISPATCH_FAILED", actorType: "SYSTEM", payload: { jobId: job.id, status: dispatched.status } });
      return NextResponse.json({ error: "The verification runner did not accept the job. Please retry." }, { status: 502, headers: noStoreJsonHeaders() });
    }

    const response = NextResponse.json({ runId: job.id, recordId: durableRecordId, recordPublicId, status: "QUEUED" }, { status: 202, headers: { ...noStoreJsonHeaders(), Location: `/api/runs/${job.id}` } });
    if (ownerToken) response.cookies.set("mp_owner", ownerToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 24 * 60 * 60 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The verification run could not be created." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

export async function GET() {
  return NextResponse.json({ demoMilestone, criteria: demoCriteria.length, durableRuns: true }, { headers: noStoreJsonHeaders() });
}
