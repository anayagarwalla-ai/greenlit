import { describe, expect, it } from "vitest";
import { demoSowText } from "./demo";
import { buildFallbackCriteria, localFallbackNotice } from "./fallback-analysis";

describe("fast local SOW fallback", () => {
  it("creates grounded, editable criteria for the synthetic SOW", () => {
    const criteria = buildFallbackCriteria(demoSowText);

    expect(criteria).toHaveLength(6);
    expect(criteria.every((criterion) => criterion.grounded)).toBe(true);
    expect(criteria.map((criterion) => criterion.checkType)).toEqual([
      "element_state",
      "link_destination",
      "element_state",
      "form_submission",
      "axe_scan",
      "viewport_layout",
    ]);
  });

  it("returns at most eight requirements in their source order", () => {
    const source = Array.from({ length: 12 }, (_, index) => `Requirement ${index + 1} must display item ${index + 1}.`).join("\n");
    const criteria = buildFallbackCriteria(source);

    expect(criteria).toHaveLength(8);
    expect(criteria[0]?.sourceQuote).toBe("Requirement 1 must display item 1.");
    expect(criteria[7]?.sourceQuote).toBe("Requirement 8 must display item 8.");
  });

  it("falls back to source-like browser promises when modal verbs are absent", () => {
    const source = "Homepage\nThe pricing page displays three plans for visitors.\nA reviewer approves the final brand voice before launch.";
    const criteria = buildFallbackCriteria(source);

    expect(criteria[0]?.sourceQuote).toBe("The pricing page displays three plans for visitors.");
    expect(criteria[0]?.checkType).toBe("element_state");
  });

  it("recognizes button-driven page navigation as a destination check", () => {
    const [criterion] = buildFallbackCriteria("Selecting the Search button must open the same-origin results page.");
    expect(criterion?.checkType).toBe("link_destination");
  });

  it("does not turn contract pricing into an acceptance criterion", () => {
    const source = "Studio will deliver the website milestone for $12,000 USD.\nThe homepage must display the approved headline.";
    const criteria = buildFallbackCriteria(source);

    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.sourceQuote).toBe("The homepage must display the approved headline.");
  });

  it("explains when consent retention prevents external processing", () => {
    const notice = localFallbackNotice("consent_record_unavailable");

    expect(notice).toContain("did not send this SOW to Google");
    expect(notice).toContain("local source parser");
    expect(notice).toContain("source-grounded draft");
  });

  it("does not incorrectly claim that a timed-out provider never received the source", () => {
    const notice = localFallbackNotice("unavailable");

    expect(notice).toContain("may already have been sent to Gemini");
    expect(notice).not.toContain("did not send this SOW");
  });
});
