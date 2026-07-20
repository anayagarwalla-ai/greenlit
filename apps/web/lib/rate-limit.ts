import { getSupabaseAdmin } from "./database";
import { requestActorHash, sha256 } from "./recordkeeping";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

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
): Promise<RateLimitResult> {
  const database = getSupabaseAdmin();
  if (!database) return { allowed: true, retryAfterSeconds: windowSeconds };
  let actor: string;
  try {
    actor = identity ? sha256(`user:${identity}`) : requestActorHash(request);
  } catch {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    actor = sha256(`${forwarded}|${request.headers.get("user-agent") ?? "unknown"}`);
  }
  const { data, error } = await database.rpc("consume_api_quota", {
    p_rate_key: actor,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit unavailable", scope, error.message);
    return { allowed: true, retryAfterSeconds: windowSeconds };
  }
  const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
  return { allowed: Boolean(data), retryAfterSeconds: Math.max(1, windowSeconds - elapsed) };
}

export function rateLimitedResponse(retryAfterSeconds: number) {
  return Response.json(
    { error: "This beta has reached its current request allowance. Please retry after the limit resets.", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}
