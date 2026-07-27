import { describe, expect, it } from "vitest";
import { sanitizedProductProperties } from "./operations";

describe("product analytics properties", () => {
  it("keeps only documented, non-identifying scalar properties", () => {
    expect(sanitizedProductProperties({
      status: "APPROVED",
      criteriaCount: 3,
      autoSend: true,
      email: "reviewer@example.test",
      agencyName: "Private agency",
      nested: { secret: "no" },
      empty: null,
    })).toEqual({
      status: "APPROVED",
      criteriaCount: 3,
      autoSend: true,
    });
  });

  it("retains decision, review-expiry, and completion dimensions", () => {
    expect(sanitizedProductProperties({
      expiryHours: 72,
      changeType: "criterion",
      changeCriterionId: "criterion-2",
      resultCount: 4,
      durationBucket: "under-30s",
      invoiceMode: "manual",
    })).toEqual({
      expiryHours: 72,
      changeType: "criterion",
      changeCriterionId: "criterion-2",
      resultCount: 4,
      durationBucket: "under-30s",
      invoiceMode: "manual",
    });
  });
});
