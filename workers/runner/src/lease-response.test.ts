import { afterEach, describe, expect, it, vi } from "vitest";

const playwrightMocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("@cloudflare/playwright", () => ({ launch: playwrightMocks.launch }));

import runner from "./index";
import { leaseResponseDisposition } from "./lease-response";

describe("lease response handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defers paused work without treating the queued job as failed", async () => {
    const response = new Response(JSON.stringify({
      error: "Verification runs are temporarily paused by the operator safety control.",
      code: "RUNS_PAUSED",
      retryable: true,
      retryAfterSeconds: 300,
    }), { status: 423, headers: { "content-type": "application/json", "retry-after": "300" } });

    await expect(leaseResponseDisposition(response)).resolves.toEqual({
      action: "retry",
      delaySeconds: 300,
      reason: "Verification runs are temporarily paused by the operator safety control.",
    });
  });

  it("acknowledges a duplicate lease race instead of retrying a failure callback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "This job was already leased or reached a terminal state.",
      code: "LEASE_ALREADY_RESOLVED",
      retryable: false,
    }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const message = {
      body: { jobId: "job-race", attempt: 1, leaseId: "d69956a0-70b6-4acd-9898-1b398fe38d8d" },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await runner.queue(
      { messages: [message] } as unknown as MessageBatch<{ jobId: string; attempt: number; leaseId: string }>,
      {
        BROWSER: {} as never,
        JOB_QUEUE: {} as Queue<{ jobId: string; attempt: number; leaseId: string }>,
        WEB_APP_URL: "https://greenlit.example",
        RUNNER_HMAC_SECRET: "test-runner-secret",
        CRON_SECRET: "test-cron-secret",
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries a paused queue message without calling the job-failure endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Verification runs are temporarily paused by the operator safety control.",
      code: "RUNS_PAUSED",
      retryable: true,
      retryAfterSeconds: 300,
    }), { status: 423, headers: { "content-type": "application/json", "retry-after": "300" } }));
    vi.stubGlobal("fetch", fetchMock);
    const message = {
      body: { jobId: "job-paused", attempt: 1, leaseId: "d69956a0-70b6-4acd-9898-1b398fe38d8d" },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await runner.queue(
      { messages: [message] } as unknown as MessageBatch<{ jobId: string; attempt: number; leaseId: string }>,
      {
        BROWSER: {} as never,
        JOB_QUEUE: {} as Queue<{ jobId: string; attempt: number; leaseId: string }>,
        WEB_APP_URL: "https://greenlit.example",
        RUNNER_HMAC_SECRET: "test-runner-secret",
        CRON_SECRET: "test-cron-secret",
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("records and acknowledges a pause that begins after the lease was acquired", async () => {
    const browser = { version: () => "test-browser", close: vi.fn().mockResolvedValue(undefined) };
    playwrightMocks.launch.mockReset().mockResolvedValue(browser);
    const responses = [
      new Response(JSON.stringify({
        jobId: "job-active-pause",
        leaseId: "d69956a0-70b6-4acd-9898-1b398fe38d8d",
        targetOrigin: "https://example.test",
        checks: [{
          id: "CHK-01",
          criterionId: "AC-01",
          type: "element_state",
          path: "/",
          sourceQuote: "The content is visible.",
          confirmedByHuman: true,
          elementRef: "main:Content",
          assertion: "visible",
        }],
        buildLabel: "release",
        originAddresses: ["93.184.216.34"],
      }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({
        error: "Verification runs are temporarily paused by the operator safety control.",
        code: "RUNS_PAUSED",
        retryable: false,
      }), { status: 423, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ outcome: "FAILED" }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()!));
    vi.stubGlobal("fetch", fetchMock);
    const message = {
      body: { jobId: "job-active-pause", attempt: 1, leaseId: "d69956a0-70b6-4acd-9898-1b398fe38d8d" },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await runner.queue(
      { messages: [message] } as unknown as MessageBatch<{ jobId: string; attempt: number; leaseId: string }>,
      {
        BROWSER: {} as never,
        JOB_QUEUE: {} as Queue<{ jobId: string; attempt: number; leaseId: string }>,
        WEB_APP_URL: "https://greenlit.example",
        RUNNER_HMAC_SECRET: "test-runner-secret",
        CRON_SECRET: "test-cron-secret",
      },
    );

    expect(fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/api/internal/jobs/job-active-pause/lease",
      "/api/internal/jobs/job-active-pause/validate-origin",
      "/api/internal/jobs/job-active-pause/fail",
    ]);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
