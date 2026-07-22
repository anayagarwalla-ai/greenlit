import { describe, expect, it } from "vitest";
import type { CheckSpec } from "@greenlit/contracts";
import { validateVerificationManifest } from "./verification-manifest";

const automated = { id: "AC-01", sourceQuote: "The contact link opens the contact page.", supported: true, checkType: "link_destination" as const };
const manual = { id: "AC-02", sourceQuote: "The design should feel premium.", supported: false, checkType: "manual" as const };
const check: CheckSpec = { id: "CHK-01", criterionId: "AC-01", type: "link_destination", path: "/", elementRef: "link:Contact", expectedPath: "/contact", sourceQuote: automated.sourceQuote, confirmedByHuman: true };

describe("validateVerificationManifest", () => {
  it("accepts exact automated coverage while preserving manual criteria", () => {
    expect(validateVerificationManifest([automated, manual], [check])).toEqual({ ok: true, automatedCriterionIds: ["AC-01"] });
  });

  it("rejects an omitted automated criterion", () => {
    expect(validateVerificationManifest([automated, { ...automated, id: "AC-03" }], [check])).toMatchObject({ ok: false, error: expect.stringContaining("exactly one") });
  });

  it("rejects relabeling an automated criterion as a different check type", () => {
    expect(validateVerificationManifest([{ ...automated, checkType: "element_state" }], [check])).toMatchObject({ ok: false, error: expect.stringContaining("not bound") });
  });

  it("rejects a check mapped to a manual criterion", () => {
    expect(validateVerificationManifest([manual], [{ ...check, criterionId: "AC-02", sourceQuote: manual.sourceQuote }])).toMatchObject({ ok: false });
  });
});
