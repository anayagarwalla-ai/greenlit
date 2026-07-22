import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchRunnerJob } from "./runner-dispatch";

describe("dispatchRunnerJob", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs and dispatches the durable job id", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", request);

    await dispatchRunnerJob("https://runner.example/", "test-secret", "3d23b677-96bc-4a7d-85c2-ef850fe4dfad");

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe("https://runner.example/v1/jobs");
    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"jobId":"3d23b677-96bc-4a7d-85c2-ef850fe4dfad"}');
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect((init.headers as Record<string, string>)["x-mp-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("surfaces a runner refusal so the caller can preserve or fail the job", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(dispatchRunnerJob("https://runner.example", "test-secret", "job-1")).rejects.toThrow("Dispatch returned 503");
  });
});
