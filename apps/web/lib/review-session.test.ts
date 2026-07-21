import { describe, expect, it } from "vitest";
import { reviewSessionCookieName, reviewSessionExpiry } from "./review-session";

describe("review sessions", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");

  it("caps an undecided session at the packet expiry", () => {
    expect(reviewSessionExpiry("2026-07-22T12:00:00.000Z", false, now)).toBe("2026-07-22T12:00:00.000Z");
  });

  it("caps an undecided long-lived packet at 72 hours", () => {
    expect(reviewSessionExpiry("2026-08-01T12:00:00.000Z", false, now)).toBe("2026-07-24T12:00:00.000Z");
  });

  it("gives an already-decided receipt a fresh 72-hour session after packet expiry", () => {
    expect(reviewSessionExpiry("2026-07-20T12:00:00.000Z", true, now)).toBe("2026-07-24T12:00:00.000Z");
  });

  it("isolates cookies for different review packets", () => {
    expect(reviewSessionCookieName("REVIEW-ONE")).not.toBe(reviewSessionCookieName("REVIEW-TWO"));
  });
});
