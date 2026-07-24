export type GeminiServiceConfiguration = {
  paidService: boolean;
  paidTierRequested: boolean;
  billingConfirmed: boolean;
  providerNoticeVersion: "gemini-paid-2026-07" | "gemini-unpaid-2026-07";
  healthDetail: string;
};

export function geminiServiceConfiguration(
  environment: Record<string, string | undefined> = process.env,
): GeminiServiceConfiguration {
  const paidTierRequested = environment.NEXT_PUBLIC_GEMINI_SERVICE_TIER?.trim().toLowerCase() === "paid";
  const billingConfirmed = environment.GEMINI_PAID_TIER_CONFIRMED?.trim().toLowerCase() === "true";
  const paidService = paidTierRequested && billingConfirmed;

  return {
    paidService,
    paidTierRequested,
    billingConfirmed,
    providerNoticeVersion: paidService ? "gemini-paid-2026-07" : "gemini-unpaid-2026-07",
    healthDetail: paidService
      ? "paid API data terms and billing explicitly confirmed"
      : paidTierRequested
        ? "paid tier selected, but server-side billing confirmation is missing"
        : "unpaid tier: confidential SOWs remain blocked",
  };
}
