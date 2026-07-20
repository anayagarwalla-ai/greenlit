import { createHmac, createHash, randomBytes } from "node:crypto";
import { requireSupabaseAdmin } from "./database";
export { RECORD_NOTICE_VERSION } from "./policy";

export const RECORD_RETENTION_YEARS = 4;
export const REVIEW_EXPIRY_HOURS = 72;
export const EVIDENCE_RETENTION_DAYS = 90;

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function publicRecordId(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function requestActorHash(request: Request): string {
  const secret = process.env.RECORD_HASH_SECRET ?? process.env.RUNNER_HMAC_SECRET;
  if (!secret) throw new Error("Record attribution secret is not configured.");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const country = request.headers.get("x-vercel-ip-country") ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  return createHmac("sha256", secret).update(`${forwarded}|${country}|${agent}`).digest("hex");
}

export async function appendAuditEvent(input: {
  recordId: string;
  eventType: string;
  actorType: "OWNER" | "REVIEWER" | "SYSTEM" | "RUNNER";
  actorHash?: string | null;
  payload?: Record<string, unknown>;
}) {
  const database = requireSupabaseAdmin();
  const { data, error } = await database.rpc("append_transaction_event", {
    p_record_id: input.recordId,
    p_event_type: input.eventType,
    p_actor_type: input.actorType,
    p_actor_hash: input.actorHash ?? null,
    p_payload: input.payload ?? {},
  });
  if (error) throw new Error(`Audit event could not be recorded: ${error.message}`);
  return data;
}

export function noStoreJsonHeaders(): Record<string, string> {
  return { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow, noarchive" };
}
