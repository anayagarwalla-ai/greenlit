import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/database";
import { retryHealthQuery } from "@/lib/health-check";
import { DATABASE_VERSION } from "@/lib/health-version";
import { signRunnerRequest } from "@/lib/hmac";
import { legalLaunchReadiness, operationalLaunchReadiness } from "@/lib/launch-readiness";
import { geminiServiceConfiguration } from "@/lib/gemini-service";
import { EXPECTED_RUNNER_VERSION } from "@/lib/runner-version";
import { getOperationalControl } from "@/lib/operational-controls";

export const runtime = "nodejs";
export const maxDuration = 30;

const WEB_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.NEXT_PUBLIC_BUILD_ID || "development";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";
  if (!deep) {
    return NextResponse.json(
      { ok: true, service: "greenlit-web" },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
    );
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  }
  const checkedAt = new Date().toISOString();
  const database = getSupabaseAdmin();
  const runnerUrl = process.env.RUNNER_URL;
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const legalConfiguration = legalLaunchReadiness();
  const operationalConfiguration = operationalLaunchReadiness();
  const geminiConfiguration = geminiServiceConfiguration();

  if (!database) {
    checks.database = { ok: false, detail: "not configured" };
  } else {
    const staleBefore = new Date(Date.now() - 12 * 60_000).toISOString();
    const staleNotificationBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const heartbeatBefore = Date.now() - 36 * 60 * 60_000;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [
      databaseProbe,
      schemaVersion,
      staleJobs,
      notifications,
      maintenance,
      invoiceMaintenance,
      notificationMaintenance,
      evidence,
      dailyRuns,
      staleInvoiceJobs,
      failedInvoices,
      failedAccountDeletions,
      failedVerificationCleanups,
      failedRecordDeletions,
      failedEvidenceDeletions,
      failedStripeEvents,
    ] = await Promise.all([
      retryHealthQuery(() => database.from("transaction_records").select("id", { head: true, count: "exact" }).limit(1)),
      retryHealthQuery(() => database.from("app_schema_versions").select("version").order("version", { ascending: false }).limit(1).maybeSingle()),
      retryHealthQuery(() => database.from("verification_jobs_v2").select("id", { head: true, count: "exact" }).or("status.eq.QUEUED,status.eq.LEASED,status.eq.RUNNING").lt("created_at", staleBefore)),
      retryHealthQuery(() => database.from("operator_notifications").select("id", { head: true, count: "exact" }).or(`delivery_status.eq.FAILED,and(delivery_status.eq.SENDING,delivery_claimed_at.lt.${staleNotificationBefore})`)),
      retryHealthQuery(() => database.from("maintenance_runs").select("status,completed_at").eq("task", "retention-and-recovery").order("started_at", { ascending: false }).limit(1).maybeSingle()),
      retryHealthQuery(() => database.from("maintenance_runs").select("status,completed_at").eq("task", "invoice-recovery").order("started_at", { ascending: false }).limit(1).maybeSingle()),
      retryHealthQuery(() => database.from("maintenance_runs").select("status,completed_at").eq("task", "notification-delivery").order("started_at", { ascending: false }).limit(1).maybeSingle()),
      retryHealthQuery(() => database.rpc("evidence_storage_usage_bytes")),
      retryHealthQuery(() => database.from("verification_jobs_v2").select("id", { head: true, count: "exact" }).gte("created_at", today.toISOString())),
      retryHealthQuery(() => database.from("invoice_jobs").select("id", { head: true, count: "exact" }).in("status", ["PENDING", "PROCESSING"]).lt("created_at", staleBefore)),
      retryHealthQuery(() => database.from("invoice_jobs").select("id", { head: true, count: "exact" }).eq("status", "FAILED")),
      retryHealthQuery(() => database.from("privacy_account_deletions").select("id", { head: true, count: "exact" }).eq("status", "FAILED")),
      retryHealthQuery(() => database.from("privacy_verification_account_cleanups").select("id", { head: true, count: "exact" }).eq("status", "FAILED")),
      retryHealthQuery(() => database.from("transaction_records").select("id", { head: true, count: "exact" }).eq("deletion_status", "FAILED")),
      retryHealthQuery(() => database.from("evidence_artifacts_v2").select("id", { head: true, count: "exact" }).eq("deletion_status", "FAILED")),
      retryHealthQuery(() => database.from("stripe_webhook_events").select("event_id", { head: true, count: "exact" }).eq("status", "FAILED")),
    ]);
    const currentDatabaseVersion = schemaVersion.data?.version ?? "missing";
    checks.database = { ok: !databaseProbe.error && !schemaVersion.error && currentDatabaseVersion === DATABASE_VERSION, detail: databaseProbe.error || schemaVersion.error ? "query failed" : currentDatabaseVersion };
    checks.jobBacklog = { ok: !staleJobs.error && (staleJobs.count ?? 0) === 0, detail: staleJobs.error ? "query failed" : (staleJobs.count ?? 0) === 0 ? "clear" : "stale jobs require operator review" };
    checks.notifications = { ok: !notifications.error && (notifications.count ?? 0) === 0, detail: notifications.error ? "query failed" : (notifications.count ?? 0) === 0 ? "clear" : "delivery failures require operator review" };
    const recoveryQueues = [
      ["invoice", failedInvoices],
      ["account-deletion", failedAccountDeletions],
      ["verification-cleanup", failedVerificationCleanups],
      ["record-deletion", failedRecordDeletions],
      ["evidence-deletion", failedEvidenceDeletions],
      ["stripe-webhook", failedStripeEvents],
    ] as const;
    const recoveryQueueQueryFailed = recoveryQueues.some(([, result]) => Boolean(result.error));
    const recoveryQueueFailures = recoveryQueues.reduce((total, [, result]) => total + (result.count ?? 0), 0);
    checks.durableRecoveryQueues = {
      ok: !recoveryQueueQueryFailed && recoveryQueueFailures === 0,
      detail: recoveryQueueQueryFailed
        ? "query failed"
        : recoveryQueueFailures === 0
          ? "clear"
          : recoveryQueues.filter(([, result]) => (result.count ?? 0) > 0).map(([name, result]) => `${name}:${result.count}`).join(", "),
    };
    const lastMaintenance = maintenance.data?.completed_at ? new Date(maintenance.data.completed_at).getTime() : 0;
    checks.retention = { ok: !maintenance.error && maintenance.data?.status === "SUCCEEDED" && lastMaintenance >= heartbeatBefore, detail: maintenance.error ? "query failed" : maintenance.data?.status === "SUCCEEDED" ? "heartbeat recorded" : "successful heartbeat missing" };
    const hourlyHeartbeatBefore = Date.now() - 3 * 60 * 60_000;
    const lastInvoiceMaintenance = invoiceMaintenance.data?.completed_at ? new Date(invoiceMaintenance.data.completed_at).getTime() : 0;
    checks.invoiceRecovery = {
      ok: !invoiceMaintenance.error
        && !staleInvoiceJobs.error
        && invoiceMaintenance.data?.status === "SUCCEEDED"
        && lastInvoiceMaintenance >= hourlyHeartbeatBefore
        && (staleInvoiceJobs.count ?? 0) === 0,
      detail: invoiceMaintenance.error || staleInvoiceJobs.error
        ? "query failed"
        : (staleInvoiceJobs.count ?? 0) > 0
          ? "stale invoice jobs require operator review"
          : invoiceMaintenance.data?.status === "SUCCEEDED" && lastInvoiceMaintenance >= hourlyHeartbeatBefore
            ? "heartbeat recorded"
            : "successful heartbeat missing",
    };
    const lastNotificationMaintenance = notificationMaintenance.data?.completed_at ? new Date(notificationMaintenance.data.completed_at).getTime() : 0;
    checks.notificationRecovery = {
      ok: !notificationMaintenance.error
        && notificationMaintenance.data?.status === "SUCCEEDED"
        && lastNotificationMaintenance >= hourlyHeartbeatBefore,
      detail: notificationMaintenance.error
        ? "query failed"
        : notificationMaintenance.data?.status === "SUCCEEDED" && lastNotificationMaintenance >= hourlyHeartbeatBefore
          ? "heartbeat recorded"
          : "successful heartbeat missing",
    };
    const evidenceBytes = Number(evidence.data ?? 0);
    checks.evidenceStorage = { ok: !evidence.error && evidenceBytes < 850_000_000, detail: evidence.error ? "query failed" : evidenceBytes < 850_000_000 ? "within beta guardrail" : "approaching free storage limit" };
    const dailyLimit = Math.max(1, Math.min(20, Number(process.env.BETA_DAILY_RUN_LIMIT || 8)));
    checks.dailyCapacity = { ok: !dailyRuns.error && (dailyRuns.count ?? 0) < dailyLimit, detail: dailyRuns.error ? "query failed" : `${dailyRuns.count ?? 0}/${dailyLimit} runs used today` };
  }

  if (!runnerUrl) {
    checks.runner = { ok: false, detail: "not configured" };
  } else {
    try {
      const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      const runner = await response.json() as { ok?: boolean };
      checks.runner = { ok: response.ok && runner.ok === true, detail: response.ok && runner.ok === true ? "reachable" : "unavailable" };
    } catch {
      checks.runner = { ok: false, detail: "unreachable" };
    }
  }

  {
    const runnerSecret = process.env.RUNNER_HMAC_SECRET;
    if (!runnerUrl || !runnerSecret) {
      checks.runnerBrowserLaunch = { ok: false, detail: "not configured" };
    } else {
      try {
        const signed = await signRunnerRequest("", runnerSecret);
        const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/health/deep`, {
          method: "POST",
          headers: { "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature },
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        });
        const deep = await response.json() as { ok?: boolean; browserVersion?: string; version?: string };
        checks.runnerBrowserLaunch = { ok: response.ok && deep.ok === true && deep.version === EXPECTED_RUNNER_VERSION, detail: deep.browserVersion || deep.version || "unavailable" };
      } catch {
        checks.runnerBrowserLaunch = { ok: false, detail: "launch failed or timed out" };
      }
    }
  }

  const ok = Object.values(checks).every((check) => check.ok);
  const workflowControls = await Promise.all([
    getOperationalControl("RUNS"),
    getOperationalControl("REVIEWS"),
    getOperationalControl("INVOICES"),
  ]);
  const launchChecks = {
    legalConfiguration: {
      ok: legalConfiguration.ok,
      detail: legalConfiguration.ok ? "complete" : `missing ${legalConfiguration.missing.join(", ")}`,
    },
    geminiDataMode: {
      ok: geminiConfiguration.paidService && Boolean(process.env.GEMINI_API_KEY),
      detail: !process.env.GEMINI_API_KEY ? "Gemini API key is not configured" : geminiConfiguration.healthDetail,
    },
    operationalConfiguration: {
      ok: operationalConfiguration.ok,
      detail: operationalConfiguration.ok ? "complete" : `missing ${operationalConfiguration.missing.join(", ")}`,
    },
    workflowControls: {
      ok: workflowControls.every((control) => !control.paused && control.source !== "unavailable"),
      detail: workflowControls
        .map((control) => `${control.feature.toLowerCase()}:${control.paused ? "paused" : control.source === "unavailable" ? "unavailable" : "available"}`)
        .join(", "),
    },
  };
  const readyForBeta = ok && Object.values(launchChecks).every((check) => check.ok);
  return NextResponse.json({ ok, readyForBeta, service: "greenlit-web", checkedAt, versions: { web: WEB_VERSION, runnerExpected: EXPECTED_RUNNER_VERSION, database: DATABASE_VERSION }, checks, launchChecks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
}
