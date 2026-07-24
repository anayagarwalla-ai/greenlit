import { describe, expect, it } from "vitest";
import { assertReviewSnapshotIntegrity, reviewSessionCookieName, reviewSessionExpiry } from "./review-session";
import { canonicalJson, sha256 } from "./recordkeeping";

describe("review sessions", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");

  it("caps an undecided session at two hours", () => {
    expect(reviewSessionExpiry("2026-07-22T12:00:00.000Z", false, now)).toBe("2026-07-21T14:00:00.000Z");
  });

  it("does not extend a long-lived packet beyond the two-hour session window", () => {
    expect(reviewSessionExpiry("2026-08-01T12:00:00.000Z", false, now)).toBe("2026-07-21T14:00:00.000Z");
  });

  it("never extends a decided review beyond the packet expiry", () => {
    expect(reviewSessionExpiry("2026-07-20T12:00:00.000Z", true, now)).toBe("2026-07-20T12:00:00.000Z");
  });

  it("isolates cookies for different review packets", () => {
    expect(reviewSessionCookieName("REVIEW-ONE")).not.toBe(reviewSessionCookieName("REVIEW-TWO"));
  });

  it("fails closed when a retained snapshot no longer matches its hash", () => {
    const snapshot = { recordId: "one", criteria: [{ id: "AC-01" }] };
    const digest = sha256(canonicalJson(snapshot));
    expect(assertReviewSnapshotIntegrity(snapshot, digest)).toBe(digest);
    expect(() => assertReviewSnapshotIntegrity({ ...snapshot, recordId: "two" }, digest)).toThrow(/integrity/i);
  });
});
