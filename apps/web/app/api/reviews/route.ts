import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "@/lib/database";
import { canonicalJson, noStoreJsonHeaders, publicRecordId, randomToken, requestActorHash, REVIEW_EXPIRY_HOURS, sha256 } from "@/lib/recordkeeping";
import { getOwnerIdentity } from "@/lib/owner-auth";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { assertReviewSnapshotIntegrity } from "@/lib/review-session";
import { logProductEvent } from "@/lib/operations";
import { assertFrozenInvoicePlan } from "@/lib/invoice-plan";
import { validateVerificationManifest } from "@/lib/verification-manifest";

const schema = z.object({
  recordId: z.string().uuid(),
  runId: z.string().uuid(),
  reviewerEmail: z.string().trim().email().max(320),
  expiryHours: z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(120), z.literal(168)]).default(REVIEW_EXPIRY_HOURS),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A completed record and run are required." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const database = requireSupabaseAdmin();
    const owner = await getOwnerIdentity();
    if (!owner.userId || !owner.user) return NextResponse.json({ error: "Sign in to create a client review." }, { status: 401, headers: noStoreJsonHeaders() });
    if (!await betaAccessAllowedFresh(owner.user)) return NextResponse.json({ error: "This account is no longer on the closed-beta invite list." }, { status: 403, headers: noStoreJsonHeaders() });
    const quota = await consumeRateLimit(request, "review-packet-day", 20, 86_400, owner.userId);
    if (!quota.allowed) return rateLimitedResponse(quota);
    const { data: record, error: recordError } = await database.from("transaction_records").select("*").eq("id", parsed.data.recordId).single();
    const authorized = record && record.owner_user_id === owner.userId;
    const { data: run, error: runError } = await database.from("verification_jobs_v2").select("*").eq("id", parsed.data.runId).eq("record_id", parsed.data.recordId).single();
    if (recordError || runError || !authorized || !run) return NextResponse.json({ error: "The passing verification record was not found." }, { status: 404, headers: noStoreJsonHeaders() });
    if (!["READY_FOR_REVIEW", "IN_REVIEW"].includes(record.status) || record.last_run_id !== run.id) return NextResponse.json({ error: "Only the milestone's current passing run can be sent for review. Refresh and try again." }, { status: 409, headers: noStoreJsonHeaders() });
    const results: unknown[] = Array.isArray(run.results) ? run.results : [];
    const checks: Array<{ criterionId?: string }> = Array.isArray(run.checks) ? run.checks : [];
    const artifacts: Array<{ criterionId?: string; sha256?: string }> = Array.isArray(run.artifacts) ? run.artifacts : [];
    const resultIds = results.map((result) => (result as { criterionId?: string }).criterionId);
    const checkIds = checks.map((check) => check.criterionId);
    const completeCoverage = checks.length > 0 && results.length === checks.length && artifacts.length === checks.length && new Set(resultIds).size === checks.length && checkIds.every((id) => resultIds.includes(id) && artifacts.some((artifact) => artifact.criterionId === id && /^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")));
    const manifestValidation = validateVerificationManifest(record.confirmed_criteria, run.checks);
    if (!manifestValidation.ok) return NextResponse.json({ error: "The run does not cover every frozen automated criterion. Rerun verification before sharing it." }, { status: 409, headers: noStoreJsonHeaders() });
    if (run.status !== "COMPLETED" || !completeCoverage || !run.manifest_sha256 || results.some((result) => (result as { status?: string }).status !== "PASS")) return NextResponse.json({ error: "Only a complete passing run with matching stored evidence can be sent for review." }, { status: 409, headers: noStoreJsonHeaders() });
    if (run.criteria_revision !== record.criteria_revision) return NextResponse.json({ error: "The criteria changed since this run completed. Rerun verification before sending for review." }, { status: 409, headers: noStoreJsonHeaders() });
    const { data: activePacket, error: activePacketError } = await database.from("review_packets_v2").select("public_id,expires_at").eq("record_id", record.id).is("decision", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (activePacketError) throw new Error(activePacketError.message);
    if (activePacket) return NextResponse.json({ error: "An active client-review link already exists. Revoke it before creating a replacement link.", activePacketId: activePacket.public_id, expiresAt: activePacket.expires_at }, { status: 409, headers: noStoreJsonHeaders() });

    const { data: planRow, error: planError } = await database.from("record_invoice_plans").select("billing_name,billing_email,days_until_due,memo,auto_send,stripe_customer_id,amount_minor,currency,criteria_revision,plan_sha256").eq("record_id", record.id).maybeSingle();
    if (planError) throw new Error(planError.message);
    let invoicePlan = undefined;
    let invoiceDeliveryMode: "TEST_DRAFT" | "LIVE_EMAIL" | "MANUAL_AFTER_APPROVAL" | undefined;
    if (planRow) {
      invoicePlan = assertFrozenInvoicePlan({ enabled: true, billingName: planRow.billing_name, billingEmail: planRow.billing_email, daysUntilDue: planRow.days_until_due, memo: planRow.memo, autoSend: planRow.auto_send, stripeCustomerId: planRow.stripe_customer_id, amountMinor: planRow.amount_minor, currency: planRow.currency, criteriaRevision: planRow.criteria_revision, planSha256: planRow.plan_sha256 });
      if (invoicePlan.amountMinor !== record.amount_minor || invoicePlan.currency !== record.currency || invoicePlan.criteriaRevision !== record.criteria_revision) return NextResponse.json({ error: "Invoice details are stale. Review and save them again before creating the client review." }, { status: 409, headers: noStoreJsonHeaders() });
      if (invoicePlan.autoSend) {
        const { data: connection } = await database.from("stripe_connections").select("status,livemode").eq("owner_user_id", owner.userId).maybeSingle();
        if (!connection || connection.status !== "CONNECTED") return NextResponse.json({ error: "Reconnect Stripe before creating a review with automatic invoice sending." }, { status: 409, headers: noStoreJsonHeaders() });
        if (connection.livemode && process.env.STRIPE_ALLOW_LIVE_MODE !== "true") return NextResponse.json({ error: "Live-mode invoicing is disabled during the beta." }, { status: 409, headers: noStoreJsonHeaders() });
        invoiceDeliveryMode = connection.livemode ? "LIVE_EMAIL" : "TEST_DRAFT";
      } else {
        invoiceDeliveryMode = "MANUAL_AFTER_APPROVAL";
      }
    }

    const packetPublicId = publicRecordId("REVIEW");
    const token = randomToken();
    const accessCode = sha256(randomToken()).slice(0, 12).toUpperCase();
    const intendedReviewerEmail = parsed.data.reviewerEmail.trim().toLowerCase();
    const expiresAt = new Date(Date.now() + parsed.data.expiryHours * 3_600_000).toISOString();
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
      revision: record.criteria_revision,
      criteria: record.confirmed_criteria,
      run: { runId: run.id, buildLabel: run.build_label, buildUrl: run.build_url, results, artifacts: run.artifacts, browserVersion: run.browser_version, runnerVersion: run.runner_version, manifestSha256: run.manifest_sha256, startedAt: run.started_at, completedAt: run.completed_at },
      ...(invoicePlan ? { invoicePlan } : {}),
      ...(invoiceDeliveryMode ? { invoiceDeliveryMode } : {}),
      intendedReviewerEmail,
      expiresAt,
    };
    const snapshotSha256 = sha256(canonicalJson(snapshot));
    assertReviewSnapshotIntegrity(snapshot, snapshotSha256);
    const { error } = await database.rpc("create_review_packet_secure_atomic", {
      p_record_id: record.id,
      p_run_id: run.id,
      p_public_id: packetPublicId,
      p_snapshot: snapshot,
      p_snapshot_sha256: snapshotSha256,
      p_bearer_token_hash: sha256(token),
      p_access_code_hash: sha256(accessCode),
      p_intended_reviewer_email: intendedReviewerEmail,
      p_expires_at: expiresAt,
      p_actor_hash: requestActorHash(request),
      p_criteria_revision: record.criteria_revision,
    });
    if (error) throw new Error(`Review packet could not be recorded: ${error.message}`);
    await logProductEvent({ eventType: "REVIEW_LINK_CREATED", ownerUserId: owner.userId, recordId: record.id, properties: { criteriaCount: record.confirmed_criteria.length, expiryHours: parsed.data.expiryHours, status: "ACTIVE" } });
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).origin;
    return NextResponse.json({
      packetId: packetPublicId,
      reviewUrl: `${origin}/review/${packetPublicId}#t=${token}`,
      accessCode,
      reviewerEmail: intendedReviewerEmail,
      expiresAt,
      snapshotSha256,
    }, { status: 201, headers: noStoreJsonHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/active review|current reviewable|stale|snapshot|criteria revision/i.test(message)) {
      return NextResponse.json({ error: "The current run cannot be shared, or an active review already exists. Refresh the project and try again." }, { status: 409, headers: noStoreJsonHeaders() });
    }
    console.error("Review packet creation failed", message || "unknown");
    return NextResponse.json({ error: "The client review could not be created. Try again shortly." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
