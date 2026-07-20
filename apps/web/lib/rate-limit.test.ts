import { describe, expect, it } from "vitest";
import { positiveIntegerSetting } from "./rate-limit";

describe("beta capacity settings", () => {
  it("accepts positive safe integers", () => {
    expect(positiveIntegerSetting("25", 20)).toBe(25);
  });

  it("falls back for missing, malformed, fractional, or non-positive values", () => {
    expect(positiveIntegerSetting(undefined, 20)).toBe(20);
    expect(positiveIntegerSetting("oops", 20)).toBe(20);
    expect(positiveIntegerSetting("2.5", 20)).toBe(20);
    expect(positiveIntegerSetting("0", 20)).toBe(20);
    expect(positiveIntegerSetting("-1", 20)).toBe(20);
  });
});
