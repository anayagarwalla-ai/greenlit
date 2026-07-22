const REQUIRED_LEGAL_SETTINGS = [
  "NEXT_PUBLIC_OPERATOR_NAME",
  "NEXT_PUBLIC_OPERATOR_ADDRESS",
  "NEXT_PUBLIC_GOVERNING_LAW",
  "NEXT_PUBLIC_VENUE",
  "NEXT_PUBLIC_SUPPORT_EMAIL",
] as const;

export function legalLaunchReadiness(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const missing = REQUIRED_LEGAL_SETTINGS.filter((name) => !environment[name]?.trim());
  const supportEmail = environment.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? "";
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) missing.push("NEXT_PUBLIC_SUPPORT_EMAIL");
  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
  };
}
