import { describe, expect, it } from "vitest";
import { isCriterionReady, isGroundedQuote, lineContainsCitation, normalizeSourceText, normalizeWhitespace } from "./analysis";

describe("SOW analysis grounding", () => {
  it("normalizes PDF whitespace without changing words", () => {
    expect(normalizeWhitespace("Plan\u00a0my   trip\nnow")).toBe("Plan my trip now");
  });

  it("accepts an exact quote with PDF line-break differences", () => {
    expect(isGroundedQuote("The mobile navigation must fit a 390px\nviewport.", "The mobile navigation must fit a 390px viewport.")).toBe(true);
    expect(isGroundedQuote("show a success confirmatio\nn.", "show a success confirmation.")).toBe(true);
  });

  it("rejects an invented or empty quote", () => {
    expect(isGroundedQuote("The CTA must be visible.", "The CTA must be blue.")).toBe(false);
    expect(isGroundedQuote("The CTA must be visible.", "  ")).toBe(false);
  });

  it("requires both a usable title and grounded quote before confirmation", () => {
    expect(isCriterionReady("The CTA must be visible.", { title: "CTA visible", sourceQuote: "The CTA must be visible." })).toBe(true);
    expect(isCriterionReady("The CTA must be visible.", { title: "No", sourceQuote: "The CTA must be visible." })).toBe(false);
  });

  it("marks source lines that overlap a citation", () => {
    expect(lineContainsCitation("The CTA must be visible on load.", ["The CTA must be visible on load."])).toBe(true);
  });
});

describe("source input cleanup", () => {
  it("removes null bytes and normalizes line endings", () => {
    expect(normalizeSourceText("  First\r\nSec\u0000ond\r  ")).toBe("First\nSecond");
  });
});
