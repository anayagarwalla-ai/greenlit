import { describe, expect, it } from "vitest";
import { buildCheck, initialDraft } from "./verification-setup";
import type { AnalysisCriterion } from "@/lib/analysis";

function criterion(checkType: AnalysisCriterion["checkType"]): AnalysisCriterion {
  return { id: "AC-01", title: "Contact form succeeds", sourceQuote: "The contact form must show a confirmation.", supported: checkType !== "manual", checkType, rationale: "Browser evidence", grounded: true };
}

describe("custom staging check mapping", () => {
  it("refuses a form that could pass without success evidence", () => {
    const draft = { ...initialDraft(), mutationAcknowledged: true };
    expect(() => buildCheck(criterion("form_submission"), draft, 0)).toThrow(/needs a success message/i);
  });

  it("builds an explicit, consented form check", () => {
    const draft = { ...initialDraft(), path: "/contact", successText: "Thanks", expectedPostPath: "/api/leads", mutationAcknowledged: true };
    const check = buildCheck(criterion("form_submission"), draft, 0);
    expect(check.type).toBe("form_submission");
    if (check.type === "form_submission") expect(check.ownerAcknowledgedMutation).toBe(true);
  });

  it("maps both standard viewports without arbitrary code", () => {
    const check = buildCheck(criterion("viewport_layout"), initialDraft(), 0);
    expect(check.type).toBe("viewport_layout");
    if (check.type === "viewport_layout") expect(check.viewports.map((item) => item.width)).toEqual([390, 1280]);
  });
});
