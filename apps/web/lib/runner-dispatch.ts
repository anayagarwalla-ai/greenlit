import { signRunnerRequest } from "./hmac";

/**
 * Dispatch is deliberately idempotent at the runner boundary: retries may
 * enqueue the same job ID more than once, while the database lease RPC allows
 * only one worker to advance QUEUED -> RUNNING.
 */
export async function dispatchRunnerJob(runnerUrl: string, secret: string, jobId: string): Promise<void> {
  const payload = JSON.stringify({ jobId });
  const signed = await signRunnerRequest(payload, secret);
  const response = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mp-timestamp": signed.timestamp,
      "x-mp-signature": signed.signature,
    },
    body: payload,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Dispatch returned ${response.status}`);
}
