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

const WEAK_SECRET_MARKERS = /(?:change[-_ ]?me|replace[-_ ]?me|example|placeholder|password|secret|test|development|local)/i;

export function strongPrivateSecret(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 32
    && new Set(normalized).size >= 12
    && !WEAK_SECRET_MARKERS.test(normalized);
}

export function validPublicWebhookUrl(value: string) {
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
    if (!strongPrivateSecret(environment[name])) missing.push(name);
  }
  const privateValues = REQUIRED_PRIVATE_SETTINGS
    .map((name) => environment[name]?.trim())
    .filter((value): value is string => Boolean(value));
  if (new Set(privateValues).size !== privateValues.length) missing.push("SECRET_SEPARATION");
  const boundedSettings = [
    ["BETA_DAILY_RUN_LIMIT", 20],
    ["BETA_DAILY_ANALYSIS_LIMIT", 500],
    ["BETA_EVIDENCE_STORAGE_LIMIT_BYTES", 900_000_000],
  ] as const;
  for (const [name, maximum] of boundedSettings) {
    const value = environment[name]?.trim();
    if (!value) continue;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) missing.push(name);
  }
  for (const name of REQUIRED_OPERATIONAL_CONFIRMATIONS) {
    if (environment[name]?.trim().toLowerCase() !== "true") missing.push(name);
  }
  const notificationWebhookUrl = environment.NOTIFICATION_WEBHOOK_URL?.trim() ?? "";
  if (notificationWebhookUrl) {
    if (!validPublicWebhookUrl(notificationWebhookUrl)) missing.push("NOTIFICATION_WEBHOOK_URL");
    if (!strongPrivateSecret(environment.NOTIFICATION_WEBHOOK_SECRET)) missing.push("NOTIFICATION_WEBHOOK_SECRET");
    if (!environment.NEXT_PUBLIC_NOTIFICATION_PROVIDER?.trim()) missing.push("NEXT_PUBLIC_NOTIFICATION_PROVIDER");
  }
  const stripeKeys = [
    "STRIPE_SECRET_KEY",
    "STRIPE_APP_CLIENT_ID",
    "STRIPE_APP_INSTALL_URL",
    "STRIPE_TOKEN_ENCRYPTION_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_API_VERSION",
  ] as const;
  if (stripeKeys.some((name) => Boolean(environment[name]?.trim()))) {
    for (const name of stripeKeys) if (!environment[name]?.trim()) missing.push(name);
    const installUrl = environment.STRIPE_APP_INSTALL_URL?.trim() ?? "";
    if (installUrl && !validPublicWebhookUrl(installUrl)) missing.push("STRIPE_APP_INSTALL_URL");
    const apiVersion = environment.STRIPE_API_VERSION?.trim() ?? "";
    if (apiVersion && !/^\d{4}-\d{2}-\d{2}\.[a-z]+$/.test(apiVersion)) missing.push("STRIPE_API_VERSION");
    const encryptionKey = environment.STRIPE_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
    if (encryptionKey && encryptionKey.length < 32) missing.push("STRIPE_TOKEN_ENCRYPTION_KEY");
    const webhookSecret = environment.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
    if (webhookSecret && webhookSecret.length < 20) missing.push("STRIPE_WEBHOOK_SECRET");
  }
  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
  };
}
