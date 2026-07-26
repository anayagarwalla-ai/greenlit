import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const requiredFiles = [
  "apps/web/public/demo-evidence/fixture-rc1.png",
  "apps/web/public/demo-evidence/fixture-rc1-false-success.png",
  "apps/web/public/demo-evidence/fixture-rc2.png",
  "docs/company-demo/20-minute-runbook.md",
  "docs/company-demo/design-partner-offer-draft.md",
  "docs/company-demo/demo-reset-checklist.md",
  "docs/company-demo/production-demo-smoke-checklist.md",
];
export const requiredLegalSettings = [
  "NEXT_PUBLIC_OPERATOR_NAME",
  "NEXT_PUBLIC_OPERATOR_ADDRESS",
  "NEXT_PUBLIC_GOVERNING_LAW",
  "NEXT_PUBLIC_VENUE",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_SECURITY_EMAIL",
];
export const requiredOperationalSettings = [
  "NEXT_PUBLIC_APP_URL",
  "BETA_ALLOWED_EMAILS",
  "ADMIN_EMAILS",
  "RUNNER_HMAC_SECRET",
  "RECORD_HASH_SECRET",
  "CRON_SECRET",
];
export const requiredOperationalConfirmations = [
  "CUSTOM_SMTP_CONFIRMED",
  "LINK_SCANNER_TEST_CONFIRMED",
  "BACKUP_SCHEDULE_CONFIRMED",
  "RESTORE_DRILL_CONFIRMED",
  "INCIDENT_OWNERS_ASSIGNED",
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validPublicWebhookUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const literalIpv4 = hostname.split(".");
    const looksLikeIpv4 = literalIpv4.length === 4 && literalIpv4.every((part) => /^\d{1,3}$/.test(part));
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && !looksLikeIpv4
      && !hostname.includes(":")
      && hostname.includes(".")
      && hostname !== "localhost"
      && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local")
      && !hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

export function productionReadinessMissing(environment = process.env) {
  const missing = [];
  for (const key of requiredLegalSettings) {
    if (!environment[key]?.trim()) missing.push(key);
  }
  for (const key of ["NEXT_PUBLIC_SUPPORT_EMAIL", "NEXT_PUBLIC_SECURITY_EMAIL"]) {
    const value = environment[key]?.trim() ?? "";
    if (value && !emailPattern.test(value)) missing.push(key);
  }

  const url = environment.NEXT_PUBLIC_APP_URL?.trim() ?? "";
  let validProductionUrl = false;
  try {
    const parsed = new URL(url);
    validProductionUrl = parsed.protocol === "https:"
      && !["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname);
  } catch {
    // The key is reported below.
  }
  if (!validProductionUrl) missing.push("NEXT_PUBLIC_APP_URL");

  for (const key of ["BETA_ALLOWED_EMAILS", "ADMIN_EMAILS"]) {
    const hasValidEmail = (environment[key] ?? "").split(",").some((value) => emailPattern.test(value.trim()));
    if (!hasValidEmail) missing.push(key);
  }
  for (const key of ["RUNNER_HMAC_SECRET", "RECORD_HASH_SECRET", "CRON_SECRET"]) {
    if (!environment[key]?.trim()) missing.push(key);
  }
  const secrets = ["RUNNER_HMAC_SECRET", "RECORD_HASH_SECRET", "CRON_SECRET"]
    .map((key) => environment[key]?.trim())
    .filter(Boolean);
  if (secrets.length === 3 && new Set(secrets).size !== 3) missing.push("SECRET_SEPARATION");

  for (const key of requiredOperationalConfirmations) {
    if (environment[key]?.trim().toLowerCase() !== "true") missing.push(key);
  }
  const notificationWebhookUrl = environment.NOTIFICATION_WEBHOOK_URL?.trim() ?? "";
  if (notificationWebhookUrl) {
    if (!validPublicWebhookUrl(notificationWebhookUrl)) missing.push("NOTIFICATION_WEBHOOK_URL");
    if (!environment.NOTIFICATION_WEBHOOK_SECRET?.trim()) missing.push("NOTIFICATION_WEBHOOK_SECRET");
    if (!environment.NEXT_PUBLIC_NOTIFICATION_PROVIDER?.trim()) missing.push("NEXT_PUBLIC_NOTIFICATION_PROVIDER");
  }
  return [...new Set(missing)];
}

export async function runCompanyDemoPreflight({
  environment = process.env,
  root = process.cwd(),
  logger = console,
} = {}) {
  let failures = 0;
  const pass = (message) => logger.log(`PASS  ${message}`);
  const fail = (message) => {
    failures += 1;
    logger.error(`BLOCK ${message}`);
  };

  for (const file of requiredFiles) {
    try {
      await access(path.join(root, file));
      pass(file);
    } catch {
      fail(`Missing ${file}`);
    }
  }

  if (environment.DEMO_PREFLIGHT_PRODUCTION === "1") {
    const missing = productionReadinessMissing(environment);
    for (const key of [...requiredLegalSettings, ...requiredOperationalSettings, ...requiredOperationalConfirmations]) {
      if (missing.includes(key)) fail(`${key} is missing, invalid, or not explicitly true`);
      else pass(`${key} is ready`);
    }
    const secretKeys = ["RUNNER_HMAC_SECRET", "RECORD_HASH_SECRET", "CRON_SECRET"];
    if (missing.includes("SECRET_SEPARATION")) {
      fail("RUNNER_HMAC_SECRET, RECORD_HASH_SECRET, and CRON_SECRET must be distinct");
    } else if (secretKeys.some((key) => missing.includes(key))) {
      logger.log("INFO  Secret separation can be confirmed after all three high-impact secrets are configured.");
    } else {
      pass("High-impact secrets are distinct");
    }
    if (environment.NOTIFICATION_WEBHOOK_URL?.trim()) {
      if (missing.includes("NOTIFICATION_WEBHOOK_URL")) {
        fail("NOTIFICATION_WEBHOOK_URL must be a public HTTPS URL without credentials, a custom port, or a literal IP address");
      } else {
        pass("Notification webhook target is a public HTTPS URL");
      }
      if (missing.includes("NOTIFICATION_WEBHOOK_SECRET")) {
        fail("NOTIFICATION_WEBHOOK_SECRET must authenticate the configured notification webhook");
      } else {
        pass("Notification webhook authentication is configured");
      }
      if (missing.includes("NEXT_PUBLIC_NOTIFICATION_PROVIDER")) {
        fail("NEXT_PUBLIC_NOTIFICATION_PROVIDER must identify the configured notification webhook provider");
      } else {
        pass("Configured notification provider is publicly disclosed");
      }
    } else {
      logger.log("INFO  Notification webhook is optional; in-app notifications remain available without one.");
    }
  } else {
    logger.log("INFO  File-level preflight only. Set DEMO_PREFLIGHT_PRODUCTION=1 with the production environment to enforce legal, operator, and provider gates.");
  }

  if (failures > 0) {
    logger.error(`\nCompany-demo preflight blocked by ${failures} item${failures === 1 ? "" : "s"}.`);
  } else {
    logger.log("\nCompany-demo preflight passed.");
  }
  return failures;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const failures = await runCompanyDemoPreflight();
  if (failures > 0) process.exitCode = 1;
}
