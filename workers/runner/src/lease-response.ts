export type LeaseResponseDisposition =
  | { action: "continue" }
  | { action: "retry"; delaySeconds: number; reason: string }
  | { action: "ack"; reason: string }
  | { action: "fail"; reason: string };

export async function leaseResponseDisposition(response: Response): Promise<LeaseResponseDisposition> {
  if (response.ok) return { action: "continue" };

  let payload: { code?: unknown; error?: unknown; retryable?: unknown; retryAfterSeconds?: unknown } = {};
  try {
    payload = await response.json() as typeof payload;
  } catch {
    // A malformed rejection remains an ordinary worker failure.
  }
  const code = typeof payload.code === "string" ? payload.code : "";
  const reason = typeof payload.error === "string" ? payload.error : `Lease failed with ${response.status}`;

  if (code === "RUNS_PAUSED") {
    if (payload.retryable === false) return { action: "fail", reason };
    const requestedDelay = typeof payload.retryAfterSeconds === "number"
      ? payload.retryAfterSeconds
      : Number(response.headers.get("retry-after") ?? 300);
    const delaySeconds = Number.isFinite(requestedDelay)
      ? Math.min(900, Math.max(5, Math.round(requestedDelay)))
      : 300;
    return { action: "retry", delaySeconds, reason };
  }
  if (code === "LEASE_ALREADY_RESOLVED" || code === "JOB_NOT_FOUND") {
    return { action: "ack", reason };
  }
  return { action: "fail", reason };
}
