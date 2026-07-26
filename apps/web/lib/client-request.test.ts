import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientRequestTimeoutError, clientRequestMessage, fetchWithTimeout } from "./client-request";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bounded client requests", () => {
  it("passes through a successful response", async () => {
    const response = new Response(null, { status: 204 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(fetchWithTimeout("/api/test", {}, 100)).resolves.toBe(response);
  });

  it("aborts a request that exceeds its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));
    const request = fetchWithTimeout("/api/test", {}, 250);
    const rejection = expect(request).rejects.toBeInstanceOf(ClientRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(251);
    await rejection;
  });

  it("turns network and timeout failures into actionable copy", () => {
    expect(clientRequestMessage(new TypeError("offline"), "Could not save.")).toContain("Check your connection");
    expect(clientRequestMessage(new ClientRequestTimeoutError(2_000), "Could not save.")).toContain("timed out");
  });
});
