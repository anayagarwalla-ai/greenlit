import type { CheckSpec } from "@milestoneproof/contracts";
import { demoCriteria } from "@/lib/demo";

export function fixtureChecks(version: "rc1" | "rc2"): CheckSpec[] {
  const path = `/fixture/${version}`;
  const source = Object.fromEntries(demoCriteria.map((criterion) => [criterion.id, criterion.source])) as Record<string, string>;
  return [
    { id: `${version}-01`, criterionId: "AC-01", type: "element_state", path, sourceQuote: source["AC-01"]!, confirmedByHuman: true, elementRef: "heading:Adventure, made simple.", assertion: "visible" },
    { id: `${version}-02`, criterionId: "AC-02", type: "link_destination", path, sourceQuote: source["AC-02"]!, confirmedByHuman: true, elementRef: "link:Plan my trip", expectedPath: "/fixture/contact" },
    { id: `${version}-03`, criterionId: "AC-03", type: "element_state", path: `${path}#trips`, sourceQuote: source["AC-03"]!, confirmedByHuman: true, elementRef: "article:Trip package", assertion: "count", expectedCount: 3 },
    { id: `${version}-04`, criterionId: "AC-04", type: "form_submission", path: `${path}#contact`, sourceQuote: source["AC-04"]!, confirmedByHuman: true, fields: [{ label: "Name", value: "MilestoneProof QA" }, { label: "Email", value: "qa@example.test" }], submitRef: "button:Send my request", successText: "We have your request.", expectedPostPath: "/api/fixture/leads", expectedStatus: 201, ownerAcknowledgedMutation: true },
    { id: `${version}-05`, criterionId: "AC-05", type: "axe_scan", path: `${path}#contact`, sourceQuote: source["AC-05"]!, confirmedByHuman: true, tags: ["wcag2a", "wcag2aa", "wcag22aa"], failImpacts: ["critical", "serious"], submitRef: "button:Send my request", ownerAcknowledgedMutation: true },
    { id: `${version}-06`, criterionId: "AC-06", type: "viewport_layout", path, sourceQuote: source["AC-06"]!, confirmedByHuman: true, viewports: [{ width: 390, height: 844, label: "Mobile" }], maxHorizontalOverflowPx: 1 },
  ];
}
