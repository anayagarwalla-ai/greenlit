import { canonicalJson, sha256 } from "./recordkeeping";

const REVIEW_SESSION_TTL_MS = 72 * 60 * 60_000;
const RECEIPT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export function reviewSessionCookieName(packetId: string) {
  return `mp_review_${sha256(packetId).slice(0, 16)}`;
}

export function receiptSessionCookieName(packetId: string) {
  return `mp_receipt_${sha256(packetId).slice(0, 16)}`;
}

export function receiptSessionExpiry(nowMs = Date.now()) {
  return new Date(nowMs + RECEIPT_SESSION_TTL_MS).toISOString();
}

export function reviewSessionExpiry(packetExpiresAt: string, _decided = false, nowMs = Date.now()) {
  void _decided;
  const sessionLimit = nowMs + REVIEW_SESSION_TTL_MS;
  return new Date(Math.min(new Date(packetExpiresAt).getTime(), sessionLimit)).toISOString();
}

export function assertReviewSnapshotIntegrity(snapshot: unknown, expectedSha256: string) {
  const actual = sha256(canonicalJson(snapshot));
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || actual !== expectedSha256) {
    throw new Error("The retained review snapshot failed its integrity check.");
  }
  return actual;
}

export async function reviewSessionAuthorized(database: ReturnType<typeof import("@/lib/database").requireSupabaseAdmin>, packetId: string, session: string | undefined) {
  if (!session) return false;
  const { data } = await database.from("review_sessions_v2").select("id, expires_at").eq("packet_id", packetId).eq("session_hash", sha256(session)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!data) return false;
  await database.from("review_sessions_v2").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return true;
}

export async function receiptSessionAuthorized(database: ReturnType<typeof import("@/lib/database").requireSupabaseAdmin>, packetId: string, session: string | undefined) {
  if (!session) return false;
  const { data } = await database.from("receipt_sessions_v2").select("id,expires_at").eq("packet_id", packetId).eq("session_hash", sha256(session)).gt("expires_at", new Date().toISOString()).maybeSingle();
  return Boolean(data);
}

export async function assertDecisionReceiptIntegrity(database: ReturnType<typeof import("@/lib/database").requireSupabaseAdmin>, packet: { record_id: string; decision?: string | null; receipt_sha256?: string | null; decision_event_hash?: string | null }) {
  if (!packet.decision) return null;
  if (!packet.receipt_sha256 || packet.receipt_sha256 !== packet.decision_event_hash) throw new Error("The retained decision receipt failed its integrity check.");
  const { data, error } = await database.from("transaction_audit_events").select("sequence,event_hash,occurred_at").eq("record_id", packet.record_id).eq("event_hash", packet.receipt_sha256).maybeSingle();
  if (error || !data) throw new Error("The retained decision audit event is missing or corrupt.");
  return data;
}

export async function hydrateReviewEvidence(database: ReturnType<typeof import("@/lib/database").requireSupabaseAdmin>, snapshot: Record<string, unknown>) {
  const run = snapshot.run && typeof snapshot.run === "object" ? snapshot.run as Record<string, unknown> : null;
  if (!run || !Array.isArray(run.artifacts)) return snapshot;
  const artifacts = await Promise.all((run.artifacts as Array<Record<string, unknown>>).map(async (artifact) => {
    const storagePath = typeof artifact.storagePath === "string" ? artifact.storagePath : null;
    if (!storagePath) return { ...artifact, url: null };
    const { data } = await database.storage.from("evidence").createSignedUrl(storagePath, 300);
    return { ...artifact, url: data?.signedUrl ?? null };
  }));
  return { ...snapshot, run: { ...run, artifacts } };
}
