import { sha256 } from "./recordkeeping";

const REVIEW_SESSION_TTL_MS = 72 * 60 * 60_000;

export function reviewSessionCookieName(packetId: string) {
  return `mp_review_${sha256(packetId).slice(0, 16)}`;
}

export function reviewSessionExpiry(packetExpiresAt: string, decided: boolean, nowMs = Date.now()) {
  const sessionLimit = nowMs + REVIEW_SESSION_TTL_MS;
  if (decided) return new Date(sessionLimit).toISOString();
  return new Date(Math.min(new Date(packetExpiresAt).getTime(), sessionLimit)).toISOString();
}

export async function reviewSessionAuthorized(database: ReturnType<typeof import("@/lib/database").requireSupabaseAdmin>, packetId: string, session: string | undefined) {
  if (!session) return false;
  const { data } = await database.from("review_sessions_v2").select("id, expires_at").eq("packet_id", packetId).eq("session_hash", sha256(session)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!data) return false;
  await database.from("review_sessions_v2").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return true;
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
