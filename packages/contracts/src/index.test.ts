import { describe, expect, it } from "vitest";
import { checkSpecSchema, isSafeRelativePath } from "./index";

describe("safe CheckSpec contract", () => {
  it("accepts a confirmed typed check", () => {
    const parsed = checkSpecSchema.parse({
      id: "check-1",
      criterionId: "AC-01",
      type: "element_state",
      path: "/",
      sourceQuote: "The hero headline is visible.",
      confirmedByHuman: true,
      elementRef: "heading:Spring collection",
      assertion: "visible",
    });
    expect(parsed.type).toBe("element_state");
  });

  it("rejects unconfirmed checks and arbitrary URLs", () => {
    expect(() => checkSpecSchema.parse({
      id: "check-1",
      criterionId: "AC-01",
      type: "element_state",
      path: "https://attacker.example",
      sourceQuote: "The hero is visible.",
      confirmedByHuman: false,
      elementRef: "heading:Hero",
      assertion: "visible",
    })).toThrow();
  });

  it("accepts only same-origin relative paths", () => {
    expect(isSafeRelativePath("/contact?source=proof")).toBe(true);
    expect(isSafeRelativePath("//attacker.example/x")).toBe(false);
    expect(isSafeRelativePath("https://attacker.example/x")).toBe(false);
  });

  it("rejects a false mutation acknowledgement on an accessibility precondition", () => {
    expect(() => checkSpecSchema.parse({
      id: "check-a11y",
      criterionId: "AC-05",
      type: "axe_scan",
      path: "/fixture/rc1#contact",
      sourceQuote: "Required-field errors are associated with their fields.",
      confirmedByHuman: true,
      submitRef: "button:Send my request",
      ownerAcknowledgedMutation: false,
    })).toThrow();
  });
});
