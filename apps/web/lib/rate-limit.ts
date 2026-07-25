import { getSupabaseAdmin } from "./database";
import { requestActorHash, sha256 } from "./recordkeeping";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number; unavailable?: boolean };

export function positiveIntegerSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function consumeRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
  identity?: string | null,
  options?: { failClosed?: boolean },
): Promise<RateLimitResult> {
  const failClosed = options?.failClosed ?? process.env.NODE_ENV === "production";
  const database = getSupabaseAdmin();
  if (!database) {
    // Only local/dev environments run without Supabase configured at all;
    // production always configures it, so this branch never masks a real
    // outage there.
    if (failClosed && process.env.NODE_ENV === "production") return { allowed: false, retryAfterSeconds: windowSeconds, unavailable: true };
    return { allowed: true, retryAfterSeconds: windowSeconds };
  }
  let actor: string;
  try {
    actor = identity ? sha256(`user:${identity}`) : requestActorHash(request);
  } catch {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    // A missing attribution secret must not restore the old User-Agent bypass:
    // changing client-controlled headers may never create a fresh quota key.
    actor = sha256(`ip:${forwarded}`);
  }
  const { data, error } = await database.rpc("consume_api_quota", {
    p_rate_key: actor,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit unavailable", scope, error.message);
    // Protected/high-cost routes (runner capacity, Gemini capacity, origin
    // network probes) must fail closed when the quota store is unreachable
    // rather than silently granting unlimited access.
    return { allowed: !failClosed, retryAfterSeconds: windowSeconds, unavailable: failClosed };
  }
  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
  return { allowed: Boolean(data), retryAfterSeconds: Math.max(1, windowSeconds - elapsed) };
}

export function rateLimitedResponse(result: RateLimitResult) {
  if (result.unavailable) return degradedRateLimitResponse();
  return Response.json(
    { error: "This beta has reached its current request allowance. Please retry after the limit resets.", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

export function degradedRateLimitResponse() {
  return Response.json(
    { error: "This action is temporarily unavailable while the request-limit service recovers. Please retry shortly.", code: "RATE_LIMIT_UNAVAILABLE" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
