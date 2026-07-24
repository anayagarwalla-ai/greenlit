import { describe, expect, it } from "vitest";
import { geminiServiceConfiguration } from "./gemini-service";

describe("geminiServiceConfiguration", () => {
  it("enables paid handling only when both the public tier and server confirmation match", () => {
    expect(geminiServiceConfiguration({
      NEXT_PUBLIC_GEMINI_SERVICE_TIER: "paid",
      GEMINI_PAID_TIER_CONFIRMED: "true",
    })).toMatchObject({
      paidService: true,
      providerNoticeVersion: "gemini-paid-2026-07",
    });
  });

  it("fails closed when a public paid label is set before billing is confirmed", () => {
    const configuration = geminiServiceConfiguration({
      NEXT_PUBLIC_GEMINI_SERVICE_TIER: "paid",
    });
    expect(configuration.paidService).toBe(false);
    expect(configuration.providerNoticeVersion).toBe("gemini-unpaid-2026-07");
    expect(configuration.healthDetail).toContain("confirmation is missing");
  });

  it("does not let server confirmation silently upgrade an unpaid deployment", () => {
    expect(geminiServiceConfiguration({
      NEXT_PUBLIC_GEMINI_SERVICE_TIER: "unpaid",
      GEMINI_PAID_TIER_CONFIRMED: "true",
    }).paidService).toBe(false);
  });
});
