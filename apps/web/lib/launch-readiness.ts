const REQUIRED_LEGAL_SETTINGS = [
  "NEXT_PUBLIC_OPERATOR_NAME",
  "NEXT_PUBLIC_OPERATOR_ADDRESS",
  "NEXT_PUBLIC_GOVERNING_LAW",
  "NEXT_PUBLIC_VENUE",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
  "NEXT_PUBLIC_SECURITY_EMAIL",
] as const;

const REQUIRED_OPERATIONAL_CONFIRMATIONS = [
  "CUSTOM_SMTP_CONFIRMED",
  "LINK_SCANNER_TEST_CONFIRMED",
  "BACKUP_SCHEDULE_CONFIRMED",
  "RESTORE_DRILL_CONFIRMED",
  "INCIDENT_OWNERS_ASSIGNED",
] as const;

const REQUIRED_PRIVATE_SETTINGS = [
  "RUNNER_HMAC_SECRET",
  "RECORD_HASH_SECRET",
  "CRON_SECRET",
] as const;

function validPublicWebhookUrl(value: string) {
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

export function legalLaunchReadiness(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const missing = REQUIRED_LEGAL_SETTINGS.filter((name) => !environment[name]?.trim());
  const supportEmail = environment.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? "";
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) missing.push("NEXT_PUBLIC_SUPPORT_EMAIL");
  const securityEmail = environment.NEXT_PUBLIC_SECURITY_EMAIL?.trim() ?? "";
  if (securityEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(securityEmail)) missing.push("NEXT_PUBLIC_SECURITY_EMAIL");
  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
  };
}

export function operationalLaunchReadiness(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const missing: string[] = [];
  const appUrl = environment.NEXT_PUBLIC_APP_URL?.trim() ?? "";
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
      missing.push("NEXT_PUBLIC_APP_URL");
    }
  } catch {
    missing.push("NEXT_PUBLIC_APP_URL");
  }
  for (const name of ["BETA_ALLOWED_EMAILS", "ADMIN_EMAILS"] as const) {
    if (!(environment[name] ?? "").split(",").some((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))) missing.push(name);
  }
  for (const name of REQUIRED_PRIVATE_SETTINGS) {
    if (!environment[name]?.trim()) missing.push(name);
  }
  const privateValues = REQUIRED_PRIVATE_SETTINGS
    .map((name) => environment[name]?.trim())
    .filter((value): value is string => Boolean(value));
  if (new Set(privateValues).size !== privateValues.length) missing.push("SECRET_SEPARATION");
  for (const name of REQUIRED_OPERATIONAL_CONFIRMATIONS) {
    if (environment[name]?.trim().toLowerCase() !== "true") missing.push(name);
  }
  const notificationWebhookUrl = environment.NOTIFICATION_WEBHOOK_URL?.trim() ?? "";
  if (notificationWebhookUrl) {
    if (!validPublicWebhookUrl(notificationWebhookUrl)) missing.push("NOTIFICATION_WEBHOOK_URL");
    if (!environment.NOTIFICATION_WEBHOOK_SECRET?.trim()) missing.push("NOTIFICATION_WEBHOOK_SECRET");
    if (!environment.NEXT_PUBLIC_NOTIFICATION_PROVIDER?.trim()) missing.push("NEXT_PUBLIC_NOTIFICATION_PROVIDER");
  }
  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
  };
}
