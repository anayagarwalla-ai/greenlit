import { describe, expect, it } from "vitest";
import { canCreateReviewLink } from "./review-lifecycle";

describe("canCreateReviewLink", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");

  it("allows the first current passing run to be shared", () => {
    expect(canCreateReviewLink("READY_FOR_REVIEW", "COMPLETED", null, now)).toBe(true);
  });

  it("allows a revised passing run to replace a changes-requested packet", () => {
    expect(canCreateReviewLink("READY_FOR_REVIEW", "COMPLETED", { decision: "CHANGES_REQUESTED", expires_at: "2026-07-22T12:00:00.000Z" }, now)).toBe(true);
  });

  it("does not resend changes before a new passing run exists", () => {
    expect(canCreateReviewLink("CHANGES_REQUESTED", "COMPLETED", { decision: "CHANGES_REQUESTED", expires_at: "2026-07-22T12:00:00.000Z" }, now)).toBe(false);
  });

  it("allows expired or revoked undecided links to be replaced", () => {
    expect(canCreateReviewLink("READY_FOR_REVIEW", "COMPLETED", { decision: null, expires_at: "2026-07-20T12:00:00.000Z" }, now)).toBe(true);
    expect(canCreateReviewLink("READY_FOR_REVIEW", "COMPLETED", { decision: null, expires_at: "2026-07-22T12:00:00.000Z", revoked_at: "2026-07-21T10:00:00.000Z" }, now)).toBe(true);
  });

  it("blocks duplicate active and approved reviews", () => {
    expect(canCreateReviewLink("READY_FOR_REVIEW", "COMPLETED", { decision: null, expires_at: "2026-07-22T12:00:00.000Z" }, now)).toBe(false);
    expect(canCreateReviewLink("APPROVED", "COMPLETED", { decision: "APPROVED", expires_at: "2026-07-22T12:00:00.000Z" }, now)).toBe(false);
  });
});
