import { describe, expect, it, vi } from "vitest";
import { retryHealthQuery } from "./health-check";

describe("retryHealthQuery", () => {
  it("does not repeat a successful probe", async () => {
    const query = vi.fn().mockResolvedValue({ error: null, data: "ok" });

    await expect(retryHealthQuery(query, 0)).resolves.toEqual({ error: null, data: "ok" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("retries one transient failure", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ error: new Error("temporary") })
      .mockResolvedValueOnce({ error: null, data: "ok" });

    await expect(retryHealthQuery(query, 0)).resolves.toEqual({ error: null, data: "ok" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("still reports a persistent failure", async () => {
    const failure = { error: new Error("down") };
    const query = vi.fn().mockResolvedValue(failure);

    await expect(retryHealthQuery(query, 0)).resolves.toBe(failure);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
