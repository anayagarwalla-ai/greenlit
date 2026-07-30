import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endSecureReviewSession,
  SECURE_SESSION_END_FAILURE,
  secureSessionEndMessage,
} from "./secure-review-session";

describe("secure review session sign-out", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves only after the server confirms the session was deleted", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await expect(endSecureReviewSession("REVIEW / 1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "/api/reviews/REVIEW%20%2F%201/session",
      expect.objectContaining({ method: "DELETE", signal: expect.any(AbortSignal) }),
    );
  });

  it("states that the reviewer remains signed in when deletion fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Please retry." }),
      { status: 503, headers: { "content-type": "application/json" } },
    )));

    await expect(endSecureReviewSession("REVIEW-1")).rejects.toThrow(
      `${SECURE_SESSION_END_FAILURE} Please retry.`,
    );
  });

  it("keeps network failures retryable without claiming sign-out succeeded", () => {
    expect(secureSessionEndMessage(new TypeError("Failed to fetch"))).toBe(
      `${SECURE_SESSION_END_FAILURE} Check your connection and retry.`,
    );
  });
});
