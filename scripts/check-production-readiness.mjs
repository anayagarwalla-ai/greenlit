#!/usr/bin/env node

const configuredUrl = process.env.HEALTHCHECK_BASE_URL?.trim();
const secret = process.env.CRON_SECRET?.trim();
if (!configuredUrl || !secret) throw new Error("HEALTHCHECK_BASE_URL and CRON_SECRET are required.");
const baseUrl = new URL(configuredUrl);
if (baseUrl.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0"].includes(baseUrl.hostname)) {
  throw new Error("HEALTHCHECK_BASE_URL must be a non-local HTTPS origin.");
}
const response = await fetch(new URL("/api/health?deep=1", baseUrl), {
  headers: { authorization: `Bearer ${secret}` },
  redirect: "error",
  cache: "no-store",
  signal: AbortSignal.timeout(25_000),
});
const result = await response.json().catch(() => null);
if (!response.ok || result?.ok !== true || result?.readyForBeta !== true) {
  const failedChecks = result && typeof result === "object"
    ? Object.entries({ ...(result.checks ?? {}), ...(result.launchChecks ?? {}) })
      .filter(([, value]) => value?.ok !== true)
      .map(([name]) => name)
    : [];
  console.error(JSON.stringify({
    ok: false,
    status: response.status,
    failedChecks,
    checkedAt: result?.checkedAt ?? null,
    versions: result?.versions ?? null,
  }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    readyForBeta: true,
    checkedAt: result.checkedAt,
    versions: result.versions,
  }));
}
