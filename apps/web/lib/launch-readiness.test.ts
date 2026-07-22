import { describe, expect, it } from "vitest";
import { legalLaunchReadiness } from "./launch-readiness";

const complete = {
  NEXT_PUBLIC_OPERATOR_NAME: "Example Operator LLC",
  NEXT_PUBLIC_OPERATOR_ADDRESS: "123 Main Street, Example, CA 90000",
  NEXT_PUBLIC_GOVERNING_LAW: "the laws of California",
  NEXT_PUBLIC_VENUE: "the state and federal courts in Example County, California",
  NEXT_PUBLIC_SUPPORT_EMAIL: "support@example.com",
};

describe("legal beta launch readiness", () => {
  it("requires every public operator and dispute setting", () => {
    expect(legalLaunchReadiness({ ...complete, NEXT_PUBLIC_VENUE: "" })).toEqual({ ok: false, missing: ["NEXT_PUBLIC_VENUE"] });
  });

  it("rejects an invalid public support address", () => {
    expect(legalLaunchReadiness({ ...complete, NEXT_PUBLIC_SUPPORT_EMAIL: "not-an-email" })).toEqual({ ok: false, missing: ["NEXT_PUBLIC_SUPPORT_EMAIL"] });
  });

  it("passes a complete configuration", () => {
    expect(legalLaunchReadiness(complete)).toEqual({ ok: true, missing: [] });
  });
});
