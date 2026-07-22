import { describe, expect, it } from "vitest";
import { assertFrozenInvoicePlan, freezeInvoicePlan, invoicePlanInputSchema } from "./invoice-plan";

describe("invoice plans", () => {
  it("freezes the exact milestone cents, currency, and criteria revision", () => {
    const input = invoicePlanInputSchema.parse({ billingName: "Acme Inc.", billingEmail: "BILLING@ACME.TEST", daysUntilDue: 14, memo: "Approved milestone", autoSend: true, stripeCustomerId: null });
    const plan = freezeInvoicePlan(input, { amount_minor: 1_200_050, currency: "USD", criteria_revision: 4 });
    expect(plan).toMatchObject({ billingEmail: "billing@acme.test", amountMinor: 1_200_050, currency: "USD", criteriaRevision: 4 });
    expect(assertFrozenInvoicePlan(plan)).toEqual(plan);
  });

  it("rejects a changed amount after the plan was hashed", () => {
    const input = invoicePlanInputSchema.parse({ billingName: "Acme Inc.", billingEmail: "billing@acme.test", daysUntilDue: 14, memo: "", autoSend: false });
    const plan = freezeInvoicePlan(input, { amount_minor: 120_000, currency: "USD", criteria_revision: 1 });
    expect(() => assertFrozenInvoicePlan({ ...plan, amountMinor: 120_001 })).toThrow(/integrity/i);
  });
});
