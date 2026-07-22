import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/database";
import { DATABASE_VERSION } from "@/lib/health-version";
import { signRunnerRequest } from "@/lib/hmac";

export const runtime = "nodejs";
export const maxDuration = 30;

const WEB_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.NEXT_PUBLIC_BUILD_ID || "development";
const EXPECTED_RUNNER_VERSION = "0.6.0";

export async function GET(request: Request) {
  const checkedAt = new Date().toISOString();
  const database = getSupabaseAdmin();
  const runnerUrl = process.env.RUNNER_URL;
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  if (!database) {
    checks.database = { ok: false, detail: "not configured" };
  } else {
    const staleBefore = new Date(Date.now() - 12 * 60_000).toISOString();
    const heartbeatBefore = Date.now() - 36 * 60 * 60_000;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [databaseProbe, schemaVersion, staleJobs, notifications, maintenance, evidence, dailyRuns] = await Promise.all([
      database.from("transaction_records").select("id", { head: true, count: "exact" }).limit(1),
      database.from("app_schema_versions").select("version").order("version", { ascending: false }).limit(1).maybeSingle(),
      database.from("verification_jobs_v2").select("id", { head: true, count: "exact" }).or("status.eq.QUEUED,status.eq.LEASED,status.eq.RUNNING").lt("created_at", staleBefore),
      database.from("operator_notifications").select("id", { head: true, count: "exact" }).eq("delivery_status", "FAILED"),
      database.from("maintenance_runs").select("status,completed_at").eq("task", "retention-and-recovery").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      database.rpc("evidence_storage_usage_bytes"),
      database.from("verification_jobs_v2").select("id", { head: true, count: "exact" }).gte("created_at", today.toISOString()),
    ]);
    const currentDatabaseVersion = schemaVersion.data?.version ?? "missing";
    checks.database = { ok: !databaseProbe.error && !schemaVersion.error && currentDatabaseVersion === DATABASE_VERSION, detail: databaseProbe.error || schemaVersion.error ? "query failed" : currentDatabaseVersion };
    checks.jobBacklog = { ok: !staleJobs.error && (staleJobs.count ?? 0) === 0, detail: staleJobs.error ? "query failed" : (staleJobs.count ?? 0) === 0 ? "clear" : "stale jobs require operator review" };
    checks.notifications = { ok: !notifications.error && (notifications.count ?? 0) === 0, detail: notifications.error ? "query failed" : (notifications.count ?? 0) === 0 ? "clear" : "delivery failures require operator review" };
    const lastMaintenance = maintenance.data?.completed_at ? new Date(maintenance.data.completed_at).getTime() : 0;
    checks.retention = { ok: !maintenance.error && maintenance.data?.status === "SUCCEEDED" && lastMaintenance >= heartbeatBefore, detail: maintenance.error ? "query failed" : maintenance.data?.status === "SUCCEEDED" ? "heartbeat recorded" : "successful heartbeat missing" };
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
      const runner = await response.json() as { ok?: boolean; version?: string; queueConfigured?: boolean; browserConfigured?: boolean; webCallbackConfigured?: boolean };
      checks.runner = { ok: response.ok && runner.ok === true && runner.version === EXPECTED_RUNNER_VERSION && runner.queueConfigured === true && runner.browserConfigured === true && runner.webCallbackConfigured === true, detail: runner.version || "unavailable" };
    } catch {
      checks.runner = { ok: false, detail: "unreachable" };
    }
  }

  const url = new URL(request.url);
  if (url.searchParams.get("deep") === "1") {
    const cronSecret = process.env.CRON_SECRET;
    const runnerSecret = process.env.RUNNER_HMAC_SECRET;
    if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
    }
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
  return NextResponse.json({ ok, service: "greenlit-web", checkedAt, versions: { web: WEB_VERSION, runnerExpected: EXPECTED_RUNNER_VERSION, database: DATABASE_VERSION }, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
}
