export type CriterionStatus = "PASS" | "FAIL" | "ERROR" | "SKIPPED";

export type DemoCriterion = {
  id: string;
  title: string;
  source: string;
  check: string;
  type: "Element" | "Navigation" | "Form" | "Accessibility" | "Layout";
  path: string;
  result: {
    rc1: CriterionStatus;
    rc2: CriterionStatus;
    expected: string;
    observedRc1: string;
    observedRc2: string;
    duration: number;
  };
};

export const demoMilestone = {
  id: "mp_spring_launch",
  project: "Acme Outdoors website",
  milestone: "Spring launch",
  agency: "Northstar Studio",
  client: "Acme Outdoors",
  amountMinor: 1_200_000,
  currency: "USD",
  target: "launch-rc2.acme-demo.test",
  revision: 3,
  sourceHash: "3f45b1d8…a209",
};

export const sowExcerpt = [
  { line: 18, text: "Acceptance criteria — Spring launch milestone" },
  { line: 19, text: "The homepage hero headline and primary ‘Plan my trip’ call-to-action must be visible on load." },
  { line: 20, text: "The primary call-to-action must take visitors to the contact page." },
  { line: 21, text: "The services section must present three distinct trip-planning packages." },
  { line: 22, text: "Submitting the contact form must create a lead and show a success confirmation." },
  { line: 23, text: "Required-field errors must be programmatically associated with their fields." },
  { line: 24, text: "The mobile navigation must fit a 390px viewport without horizontal scrolling." },
];

export const demoSowText = `STATEMENT OF WORK
Acme Outdoors / Northstar Studio

Project: Spring launch website
Milestone 3: Production-ready marketing site

Acceptance criteria — Spring launch milestone
The homepage hero headline and primary ‘Plan my trip’ call-to-action must be visible on load.
The primary call-to-action must take visitors to the contact page.
The services section must present three distinct trip-planning packages.
Submitting the contact form must create a lead and show a success confirmation.
Required-field errors must be programmatically associated with their fields.
The mobile navigation must fit a 390px viewport without horizontal scrolling.

This is a synthetic demonstration document. It contains no client-confidential information.`;

export const demoCriteria: DemoCriterion[] = [
  {
    id: "AC-01",
    title: "Hero and primary CTA are visible",
    source: "The homepage hero headline and primary ‘Plan my trip’ call-to-action must be visible on load.",
    check: "Find heading “Adventure, made simple” and button “Plan my trip”; both are visible.",
    type: "Element",
    path: "/",
    result: { rc1: "PASS", rc2: "PASS", expected: "2 visible elements", observedRc1: "2 visible elements", observedRc2: "2 visible elements", duration: 418 },
  },
  {
    id: "AC-02",
    title: "Primary CTA reaches the contact page",
    source: "The primary call-to-action must take visitors to the contact page.",
    check: "Activate “Plan my trip”; final same-origin path equals /fixture/contact.",
    type: "Navigation",
    path: "/",
    result: { rc1: "PASS", rc2: "PASS", expected: "Destination /fixture/contact", observedRc1: "Destination /fixture/contact", observedRc2: "Destination /fixture/contact", duration: 563 },
  },
  {
    id: "AC-03",
    title: "Three service packages are presented",
    source: "The services section must present three distinct trip-planning packages.",
    check: "Count accessible region items under “Trip planning”; count equals 3.",
    type: "Element",
    path: "/#services",
    result: { rc1: "PASS", rc2: "PASS", expected: "3 package cards", observedRc1: "3 package cards", observedRc2: "3 package cards", duration: 384 },
  },
  {
    id: "AC-04",
    title: "Contact form creates a lead",
    source: "Submitting the contact form must create a lead and show a success confirmation.",
    check: "Submit labeled staging fields; expect success text and POST /api/leads → 201.",
    type: "Form",
    path: "/#contact",
    result: { rc1: "FAIL", rc2: "PASS", expected: "Success text + HTTP 201", observedRc1: "Success text shown, but POST returned 500", observedRc2: "Success text shown; POST returned 201", duration: 821 },
  },
  {
    id: "AC-05",
    title: "Required errors identify their fields",
    source: "Required-field errors must be programmatically associated with their fields.",
    check: "Submit empty form; every validation-message ID is referenced by its field’s aria-describedby.",
    type: "Accessibility",
    path: "/#contact",
    result: { rc1: "PASS", rc2: "PASS", expected: "All invalid fields are programmatically described", observedRc1: "2 described fields; 0 broken references", observedRc2: "2 described fields; 0 broken references", duration: 1094 },
  },
  {
    id: "AC-06",
    title: "Mobile navigation does not overflow",
    source: "The mobile navigation must fit a 390px viewport without horizontal scrolling.",
    check: "At 390 × 844, document horizontal overflow is at most 1px.",
    type: "Layout",
    path: "/",
    result: { rc1: "PASS", rc2: "PASS", expected: "≤ 1px horizontal overflow", observedRc1: "0px horizontal overflow", observedRc2: "0px horizontal overflow", duration: 446 },
  },
];

export const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function seededDemoResults(version: "rc1" | "rc2", timestamp = new Date().toISOString()) {
  return demoCriteria.map((criterion) => ({
    criterionId: criterion.id,
    status: criterion.result[version],
    expected: criterion.result.expected,
    observed: version === "rc1" ? criterion.result.observedRc1 : criterion.result.observedRc2,
    durationMs: criterion.result.duration,
    timestamp,
  }));
}
