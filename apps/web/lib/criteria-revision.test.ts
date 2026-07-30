import { describe, expect, it } from "vitest";
import { sameConfirmedCriteriaRevision, type CriterionRevisionValue } from "./criteria-revision";

const frozen: CriterionRevisionValue[] = [
  { id: "AC-01", title: "Search is visible", sourceQuote: "Search is visible.", supported: true, checkType: "element_state" },
  { id: "AC-02", title: "Client accepts design", sourceQuote: "Client accepts design.", supported: false, checkType: "manual" },
];

describe("sameConfirmedCriteriaRevision", () => {
  it("accepts an unchanged frozen criterion revision", () => {
    expect(sameConfirmedCriteriaRevision(frozen.map((criterion) => ({ ...criterion })), frozen)).toBe(true);
  });

  it("detects changed copy, evidence metadata, membership, and order", () => {
    expect(sameConfirmedCriteriaRevision([{ ...frozen[0]!, title: "Search works" }, frozen[1]!], frozen)).toBe(false);
    expect(sameConfirmedCriteriaRevision([{ ...frozen[0]!, checkType: "manual" }, frozen[1]!], frozen)).toBe(false);
    expect(sameConfirmedCriteriaRevision([frozen[0]!], frozen)).toBe(false);
    expect(sameConfirmedCriteriaRevision([...frozen].reverse(), frozen)).toBe(false);
  });
});
