import { NextResponse } from "next/server";
import { resolve4, resolve6 } from "node:dns/promises";
import { z } from "zod";
import { checkSpecSchema, type CheckSpec } from "@milestoneproof/contracts";
import { signRunnerRequest } from "@/lib/hmac";
import { fixtureChecks } from "@/lib/demo-checks";
import { demoCriteria, demoMilestone } from "@/lib/demo";
import { requireSupabaseAdmin } from "@/lib/database";
import { canonicalJson, noStoreJsonHeaders, publicRecordId, randomToken, requestActorHash, sha256 } from "@/lib/recordkeeping";
import { RECORD_NOTICE_VERSION } from "@/lib/policy";
import { getOwnerIdentity } from "@/lib/owner-auth";
import { verifyOriginProof } from "@/lib/origin-proof";
import { consumeRateLimit, positiveIntegerSetting, rateLimitedResponse } from "@/lib/rate-limit";
import { assertSafeResolvedAddresses, validateStagingUrl } from "@/lib/security";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { logOperationalEvent, logProductEvent } from "@/lib/operations";
import { sanitizeWorkspaceState } from "@/lib/workspace-state";

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
  checks: z.array(checkSpecSchema).min(1).max(6).optional(),
  ownerTermsAccepted: z.literal(true),
  noticeVersion: z.literal(RECORD_NOTICE_VERSION),
  workspaceState: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 1_000_000, "Workspace snapshot is too large.").optional(),
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
    if (!owner.user || !await betaAccessAllowedFresh(owner.user)) return NextResponse.json({ error: "This account is not on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
    if (body.sourceMode === "demo") return NextResponse.json({ error: "Synthetic demo data cannot create a retained transaction. Use the guided walkthrough instead." }, { status: 422, headers: noStoreJsonHeaders() });
    const criterionIds = body.criteria.map((criterion) => criterion.id);
    if (new Set(criterionIds).size !== criterionIds.length) return NextResponse.json({ error: "Every acceptance criterion must have a unique ID." }, { status: 422, headers: noStoreJsonHeaders() });
    if (body.checks) {
      const checkIds = body.checks.map((check) => check.id);
      const mappedCriteria = body.checks.map((check) => check.criterionId);
      if (new Set(checkIds).size !== checkIds.length || new Set(mappedCriteria).size !== mappedCriteria.length) return NextResponse.json({ error: "Every automated check and criterion mapping must be unique." }, { status: 422, headers: noStoreJsonHeaders() });
    }
    const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    const customTarget = Boolean(body.targetUrl || body.checks || body.originReceipt);
    let targetOrigin = appOrigin;
    let buildUrl = `${appOrigin}/fixture/${body.version}`;
    let buildLabel = `launch-${body.version}`;
    let checks: CheckSpec[] = fixtureChecks(body.version);
    let originAddresses: string[] = [];
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
      const [v4, v6] = await Promise.all([resolve4(target.url.hostname).catch(() => []), resolve6(target.url.hostname).catch(() => [])]);
      originAddresses = [...v4, ...v6].sort();
      assertSafeResolvedAddresses(originAddresses);
    } else {
      const criteriaById = new Map(body.criteria.map((criterion) => [criterion.id, criterion]));
      const invalidFixtureCheck = checks.find((check) => {
        const criterion = criteriaById.get(check.criterionId);
        return !criterion
          || criterion.sourceQuote !== check.sourceQuote
          || criterion.checkType !== check.type
          || criterion.supported === false;
      });
      if (invalidFixtureCheck || body.criteria.length !== checks.length) {
        return NextResponse.json({ error: "The fixed sample can only verify its matching six source-backed criteria. Use custom-origin setup for other scopes." }, { status: 422, headers: noStoreJsonHeaders() });
      }
    }
    if (originAddresses.length === 0) {
      const frozenTarget = new URL(targetOrigin);
      const [v4, v6] = await Promise.all([resolve4(frozenTarget.hostname).catch(() => []), resolve6(frozenTarget.hostname).catch(() => [])]);
      originAddresses = [...v4, ...v6].sort();
      assertSafeResolvedAddresses(originAddresses);
    }
    const sourceHash = body.sourceSha256;
    const criteriaHash = sha256(canonicalJson(body.criteria));
    const recordId = body.recordId;
    let recordPublicId: string;

    if (recordId) {
      const { data: record, error } = await database.from("transaction_records").select("id, public_id, owner_user_id, owner_token_hash, status, criteria_revision").eq("id", recordId).single();
      const authorized = record && record.owner_user_id === owner.userId;
      if (error || !authorized) return NextResponse.json({ error: "The milestone record no longer exists or belongs to another account." }, { status: 404, headers: noStoreJsonHeaders() });
      recordPublicId = record.public_id;
      const { data: activeJob } = await database.from("verification_jobs_v2").select("id, status").eq("record_id", recordId).in("status", ["QUEUED", "LEASED", "RUNNING"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (activeJob) return NextResponse.json({ runId: activeJob.id, recordId, recordPublicId, status: activeJob.status, resumed: true }, { status: 202, headers: { ...noStoreJsonHeaders(), Location: `/api/runs/${activeJob.id}` } });
      if (!["READY", "NEEDS_WORK", "CHANGES_REQUESTED", "READY_FOR_REVIEW"].includes(record.status)) return NextResponse.json({ error: `This milestone cannot start a new run while it is ${record.status.toLowerCase().replaceAll("_", " ")}.` }, { status: 409, headers: noStoreJsonHeaders() });
    } else {
      recordPublicId = publicRecordId("MP");
    }
    const quota = await consumeRateLimit(request, "verification-run-day", 3, 86_400, owner.userId, { failClosed: true });
    if (!quota.allowed) return rateLimitedResponse(quota.retryAfterSeconds);
    const globalLimit = positiveIntegerSetting(process.env.BETA_DAILY_RUN_LIMIT, 3);
    const capacity = await consumeRateLimit(request, "verification-capacity-day", globalLimit, 86_400, "milestoneproof-global-browser-capacity", { failClosed: true });
    if (!capacity.allowed) return NextResponse.json({ error: "Today’s closed-beta browser capacity has been used. The guided demo remains available; retained runs reopen after the daily reset.", code: "BETA_CAPACITY_REACHED" }, { status: 429, headers: { ...noStoreJsonHeaders(), "Retry-After": String(capacity.retryAfterSeconds) } });

    const workspaceState = sanitizeWorkspaceState(body.workspaceState ?? { criteria: body.criteria, checks, buildLabel, targetOrigin, business: { agency: body.agencyName, client: body.clientName, project: body.projectName, milestone: body.milestoneTitle, amountMinor: body.amountMinor, currency: body.currency }, sourceName: body.sourceName, sourceSha256: sourceHash });
    const { data: queued, error: queueError } = await database.rpc("queue_verification_job_atomic", {
      p_record_id: recordId ?? null, p_record_public_id: recordPublicId, p_owner_user_id: owner.userId,
      p_owner_token_hash: sha256(randomToken()), p_mode: customTarget ? "CUSTOM_TARGET" : "IMPORTED_FIXTURE",
      p_agency_name: body.agencyName, p_client_name: body.clientName, p_project_name: body.projectName,
      p_milestone_title: body.milestoneTitle, p_amount_minor: body.amountMinor, p_currency: body.currency,
      p_source_name: body.sourceName, p_source_sha256: sourceHash, p_criteria: body.criteria,
      p_criteria_sha256: criteriaHash, p_target_origin: targetOrigin, p_build_url: buildUrl,
      p_build_label: buildLabel, p_checks: checks, p_runner_version: "0.6.0", p_workspace_state: workspaceState,
      p_actor_hash: actorHash, p_notice_version: body.noticeVersion, p_origin_addresses: originAddresses,
    });
    if (queueError || !queued) throw new Error(`Verification could not be queued atomically: ${queueError?.message ?? "unknown error"}`);
    const durableRecordId = String((queued as { recordId: string }).recordId);
    const jobId = String((queued as { jobId: string }).jobId);

    const payload = JSON.stringify({ jobId });
    const signed = await signRunnerRequest(payload, secret);
    try {
      const dispatched = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature },
        body: payload,
        signal: AbortSignal.timeout(8_000),
      });
      if (!dispatched.ok) throw new Error(`Dispatch returned ${dispatched.status}`);
    } catch (dispatchError) {
      const dispatchMessage = dispatchError instanceof Error ? dispatchError.message : "Runner dispatch failed";
      const { error: failError } = await database.rpc("fail_verification_job_atomic", { p_job_id: jobId, p_attempt: 1, p_error: dispatchMessage.slice(0, 300), p_event_type: "VERIFICATION_DISPATCH_FAILED" });
      await logOperationalEvent({ severity: "ERROR", service: "web", eventType: failError ? "RUNNER_DISPATCH_RECOVERY_FAILED" : "RUNNER_DISPATCH_FAILED", recordId: durableRecordId, details: { jobId, error: dispatchMessage, recoveryError: failError?.message ?? null } });
      return NextResponse.json({ error: failError ? "The runner dispatch failed and the job needs operator recovery." : "The verification runner did not accept the job. Please retry." }, { status: 502, headers: noStoreJsonHeaders() });
    }

    await logProductEvent({ eventType: "VERIFICATION_QUEUED", ownerUserId: owner.userId, recordId: durableRecordId, properties: { mode: customTarget ? "custom" : "fixture", checkCount: checks.length, criteriaCount: body.criteria.length, status: "QUEUED" } });
    return NextResponse.json({ runId: jobId, recordId: durableRecordId, recordPublicId, status: "QUEUED" }, { status: 202, headers: { ...noStoreJsonHeaders(), Location: `/api/runs/${jobId}` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The verification run could not be created." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}

export async function GET() {
  return NextResponse.json({ demoMilestone, criteria: demoCriteria.length, durableRuns: true }, { headers: noStoreJsonHeaders() });
}
