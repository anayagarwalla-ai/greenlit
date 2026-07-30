import { describe, expect, it } from "vitest";
import type { AnalysisCriterion } from "./analysis";
import { draftHintForCandidate, mappingIntentTerms, suggestMappings, type MappingCandidate } from "./mapping-suggestions";

function criterion(checkType: AnalysisCriterion["checkType"], title = "Search button functionality"): AnalysisCriterion {
  return {
    id: "AC-01",
    title,
    sourceQuote: "The search button must be visible and usable.",
    rationale: "Observe the named control.",
    supported: checkType !== "manual",
    checkType,
    grounded: true,
  };
}

function candidate(patch: Partial<MappingCandidate> = {}): MappingCandidate {
  return {
    id: "candidate-1",
    path: "/",
    role: "button",
    name: "Search",
    ref: "button:Search",
    visible: true,
    enabled: true,
    matchCount: 1,
    unique: true,
    ...patch,
  };
}

describe("suggestMappings", () => {
  it("bounds normalized intent terms for relevant same-origin discovery", () => {
    expect(mappingIntentTerms([criterion("element_state")])).toEqual(expect.arrayContaining(["search", "button", "functionality"]));
    expect(mappingIntentTerms(Array.from({ length: 50 }, (_, index) => criterion("element_state", `Unique control ${index}`)))).toHaveLength(24);
  });

  it("selects a unique observed control without inventing a role or name", () => {
    const result = suggestMappings([criterion("element_state")], [candidate()], ["/"])[0]!;
    expect(result.status).toBe("suggested");
    expect(result.draft).toMatchObject({ path: "/", elementRef: "button:Search" });
  });

  it("inherits a same-origin link destination observed by the runner", () => {
    const link = candidate({ role: "link", ref: "link:Contact us", name: "Contact us", href: "/contact" });
    const result = suggestMappings([criterion("link_destination", "Contact link reaches contact page")], [link], ["/"])[0]!;
    expect(result.draft).toMatchObject({ elementRef: "link:Contact us", expectedPath: "/contact" });
  });

  it("can ground a button-driven navigation target without inventing its destination", () => {
    const button = candidate({ name: "Search", ref: "button:Search" });
    const result = suggestMappings([criterion("link_destination", "Search button opens results page")], [button], ["/"])[0]!;
    expect(result.status).toBe("suggested");
    expect(result.draft).toMatchObject({ path: "/", elementRef: "button:Search" });
    expect(result.draft).not.toHaveProperty("expectedPath");
  });

  it("keeps duplicate and absent controls unresolved instead of fabricating a mapping", () => {
    const duplicate = candidate({ matchCount: 2, unique: false });
    expect(suggestMappings([criterion("element_state")], [duplicate], ["/"])[0]!.status).toBe("unresolved");
    expect(suggestMappings([criterion("element_state")], [], ["/"])[0]!.draft).toBeUndefined();
  });

  it("does not auto-select an unrelated sole control or a short substring match", () => {
    const unrelated = candidate({ name: "Pricing", ref: "button:Pricing" });
    expect(suggestMappings([criterion("element_state")], [unrelated], ["/"])[0]!.status).toBe("ambiguous");

    const shortName = candidate({ name: "Go", ref: "button:Go" });
    expect(suggestMappings([criterion("element_state", "Google search integration")], [shortName], ["/"])[0]!.status).toBe("ambiguous");
  });

  it("suggests only fillable form fields and never invents a response status", () => {
    const submit = candidate({
      name: "Send request",
      ref: "button:Send request",
      path: "/contact",
      form: {
        action: "/api/leads",
        method: "post",
        fields: [
          { label: "Email", controlType: "email", required: true },
          { label: "Plan", controlType: "select", required: true },
        ],
      },
    });
    const hint = draftHintForCandidate(criterion("form_submission", "Contact form creates a lead"), submit);
    expect(hint).toMatchObject({
      path: "/contact",
      submitRef: "button:Send request",
      fields: "Email=qa+greenlit@example.com",
      expectedPostPath: "/api/leads",
    });
    expect(hint).not.toHaveProperty("expectedStatus");
  });

  it("does not suggest forms with disabled submits or required unsupported controls", () => {
    const form = {
      action: "/api/leads",
      method: "post" as const,
      fields: [
        { label: "Email", controlType: "email" as const, required: true },
        { label: "Plan", controlType: "select" as const, required: true },
      ],
    };
    expect(suggestMappings([criterion("form_submission", "Contact form creates a lead")], [candidate({ form, enabled: false })], ["/"])[0]!.status).toBe("unresolved");
    expect(suggestMappings([criterion("form_submission", "Contact form creates a lead")], [candidate({ form })], ["/"])[0]!.status).toBe("unresolved");
  });

  it("does not automate a manual promise", () => {
    const result = suggestMappings([criterion("manual", "Design feels premium")], [candidate()], ["/"])[0]!;
    expect(result.status).toBe("not_needed");
    expect(result.choices).toEqual([]);
  });
});
