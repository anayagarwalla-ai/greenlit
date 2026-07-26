export class ClientRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The request took longer than ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = "ClientRequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const upstream = init.signal;
  const abortFromUpstream = () => controller.abort(upstream?.reason);
  if (upstream) {
    if (upstream.aborted) abortFromUpstream();
    else upstream.addEventListener("abort", abortFromUpstream, { once: true });
  }
  const timeout = globalThis.setTimeout(() => controller.abort(new ClientRequestTimeoutError(timeoutMs)), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !upstream?.aborted) {
      throw controller.signal.reason instanceof ClientRequestTimeoutError
        ? controller.signal.reason
        : new ClientRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    upstream?.removeEventListener("abort", abortFromUpstream);
  }
}

export function clientRequestMessage(error: unknown, fallback: string): string {
  if (error instanceof ClientRequestTimeoutError) {
    return `${fallback} The request timed out; retry when your connection is stable.`;
  }
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return `${fallback} Check your connection and retry.`;
  }
  return error instanceof Error ? error.message : fallback;
}
