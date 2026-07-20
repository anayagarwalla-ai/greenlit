import { NextResponse } from "next/server";
import { z } from "zod";
import { checkSpecSchema, type CheckSpec } from "@milestoneproof/contracts";
import { signRunnerRequest } from "@/lib/hmac";
import { fixtureChecks } from "@/lib/demo-checks";
import { demoCriteria, demoMilestone } from "@/lib/demo";
import { requireSupabaseAdmin } from "@/lib/database";
import { appendAuditEvent, canonicalJson, noStoreJsonHeaders, publicRecordId, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";
import { getOwnerIdentity } from "@/lib/owner-auth";
import { verifyOriginProof } from "@/lib/origin-proof";
import { consumeRateLimit, positiveIntegerSetting, rateLimitedResponse } from "@/lib/rate-limit";
import { validateStagingUrl } from "@/lib/security";
import { betaAccessAllowed } from "@/lib/beta-access";
import { logOperationalEvent } from "@/lib/operations";

export const runtime = "nodejs";

const criterionSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(300),
  sourceQuote: z.string().min(3).max(1_000),
  supported: z.boolean().optional(),
  checkType: z.enum(["element_state", "link_destination", "form_submission", "viewport_layout", "axe_scan", "manual"]).optional(),
});

const schema = z.object({
  recordId: z.string().uuid().optional(),
  version: z.enum(["rc1", "rc2"]).default("rc1"),
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
  targetUrl: z.string().url().max(2_000).optional(),
  originReceipt: z.string().min(20).max(4_000).optional(),
  buildLabel: z.string().trim().min(1).max(80).optional(),
  checks: z.array(checkSpecSchema).min(1).max(40).optional(),
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
    const owner = await getOwnerIdentity();
    if (!owner.userId) return NextResponse.json({ error: "Sign in before creating a retained verification run." }, { status: 401, headers: noStoreJsonHeaders() });
    if (!owner.user || !betaAccessAllowed(owner.user)) return NextResponse.json({ error: "This account is not on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
    const quota = await consumeRateLimit(request, "verification-run-day", 8, 86_400, owner.userId);
    if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
    const globalLimit = positiveIntegerSetting(process.env.BETA_DAILY_RUN_LIMIT, 8);
    const capacity = await consumeRateLimit(request, "verification-capacity-day", globalLimit, 86_400, "milestoneproof-global-browser-capacity");
    if (!capacity.allowed) return NextResponse.json({ error: "Today’s closed-beta browser capacity has been used. The guided demo remains available; retained runs reopen after the daily reset.", code: "BETA_CAPACITY_REACHED" }, { status: 429, headers: { ...noStoreJsonHeaders(), "Retry-After": String(capacity.retryAfterSeconds) } });
    const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    const customTarget = Boolean(body.targetUrl || body.checks || body.originReceipt);
    let targetOrigin = appOrigin;
    let buildUrl = `${appOrigin}/fixture/${body.version}`;
    let buildLabel = `launch-${body.version}`;
    let checks: CheckSpec[] = fixtureChecks(body.version);
    if (customTarget) {
      if (!body.targetUrl || !body.originReceipt || !body.buildLabel || !body.checks) return NextResponse.json({ error: "Verify the staging origin and complete every automated check mapping." }, { status: 422, headers: noStoreJsonHeaders() });
      const target = validateStagingUrl(body.targetUrl);
      if (!target.ok) return NextResponse.json({ error: target.reason }, { status: 422, headers: noStoreJsonHeaders() });
      targetOrigin = target.url.origin;
      if (!verifyOriginProof(body.originReceipt, targetOrigin, owner.userId)) return NextResponse.json({ error: "The staging-origin verification expired or does not match this account. Verify it again." }, { status: 409, headers: noStoreJsonHeaders() });
      const criteriaById = new Map(body.criteria.map((criterion) => [criterion.id, criterion]));
      const invalidCheck = body.checks.find((check) => {
        const criterion = criteriaById.get(check.criterionId);
        return !criterion || criterion.sourceQuote !== check.sourceQuote || !check.confirmedByHuman;
      });
      if (invalidCheck) return NextResponse.json({ error: `Check ${invalidCheck.id} is not bound to its confirmed source criterion.` }, { status: 422, headers: noStoreJsonHeaders() });
      checks = body.checks;
      buildUrl = targetOrigin;
      buildLabel = body.buildLabel;
    }
    const sourceHash = body.sourceSha256;
    const criteriaHash = sha256(canonicalJson(body.criteria));
    let recordId = body.recordId;
    let recordPublicId: string;
    let ownerToken: string | null = null;

    if (recordId) {
      const { data: record, error } = await database.from("transaction_records").select("id, public_id, owner_user_id, owner_token_hash").eq("id", recordId).single();
      const authorized = record && (record.owner_user_id === owner.userId || Boolean(owner.ownerTokenHash && record.owner_token_hash === owner.ownerTokenHash));
      if (error || !authorized) return NextResponse.json({ error: "The milestone record no longer exists or belongs to another account." }, { status: 404, headers: noStoreJsonHeaders() });
      recordPublicId = record.public_id;
    } else {
      recordPublicId = publicRecordId("MP");
      ownerToken = randomToken();
      const { data: record, error } = await database.from("transaction_records").insert({
        public_id: recordPublicId,
        owner_token_hash: sha256(ownerToken),
        owner_user_id: owner.userId,
        mode: customTarget ? "CUSTOM_TARGET" : body.sourceMode === "demo" ? "GUIDED_DEMO" : "IMPORTED_FIXTURE",
        agency_name: body.agencyName,
        client_name: body.clientName,
        project_name: body.projectName,
        milestone_title: body.milestoneTitle,
        amount_minor: body.amountMinor,
        currency: body.currency,
        source_name: body.sourceName,
        source_sha256: sourceHash,
        confirmed_criteria: body.criteria,
        target_origin: targetOrigin,
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
      target_origin: targetOrigin,
      build_url: buildUrl,
      build_label: buildLabel,
      checks,
      runner_version: "0.4.0",
    }).select("id").single();
    if (jobError || !job) throw new Error(`Verification job could not be recorded: ${jobError?.message ?? "unknown error"}`);

    await database.from("transaction_records").update({ status: "VERIFYING" }).eq("id", durableRecordId);
    await appendAuditEvent({ recordId: durableRecordId, eventType: "VERIFICATION_QUEUED", actorType: "OWNER", actorHash, payload: { jobId: job.id, buildLabel, targetOrigin, checkCount: checks.length, customTarget } });

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
      await logOperationalEvent({ severity: "ERROR", service: "web", eventType: "RUNNER_DISPATCH_FAILED", recordId: durableRecordId, details: { jobId: job.id, status: dispatched.status } });
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
