import { sha256 } from "@/lib/recordkeeping";

export function reviewSessionCookieName(packetId: string) {
  return `mp_review_${sha256(packetId).slice(0, 16)}`;
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
