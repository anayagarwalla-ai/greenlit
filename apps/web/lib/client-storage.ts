"use client";

// Browser drafts are isolated by both account and project. Review bearer
// tokens are never persisted here; only non-secret packet ids may appear in a
// workspace snapshot.
const DRAFT_VERSION = "v4";
const LEGACY_GLOBAL_KEYS = [
  "milestoneproof-workspace-draft-v2",
  "milestoneproof-approved-url",
  "milestoneproof-demo-decision",
];
const PENDING_CLAIM_KEY = `milestoneproof-pending-draft-claim-${DRAFT_VERSION}`;

function ownerKey(email: string | null | undefined): string {
  return (email || "anon").trim().toLowerCase() || "anon";
}

function draftIndexKey(email: string | null | undefined): string {
  return `milestoneproof-draft-index-${DRAFT_VERSION}:${ownerKey(email)}`;
}

export function activeDraftStorageKey(email: string | null | undefined): string {
  return `milestoneproof-active-draft-${DRAFT_VERSION}:${ownerKey(email)}`;
}

export function legacyDraftStorageKey(email: string | null | undefined): string {
  return `milestoneproof-draft-v3:${ownerKey(email)}`;
}

export function draftStorageKey(email: string | null | undefined, draftId = "default"): string {
  return `milestoneproof-draft-${DRAFT_VERSION}:${ownerKey(email)}:${draftId}`;
}

function readIndex(email: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(draftIndexKey(email)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function writeIndex(email: string | null | undefined, ids: string[]): void {
  window.localStorage.setItem(draftIndexKey(email), JSON.stringify([...new Set(ids)]));
}

export function activeDraftId(email: string | null | undefined): string | null {
  try { return window.localStorage.getItem(activeDraftStorageKey(email)); }
  catch { return null; }
}

export function saveProjectDraft(email: string | null | undefined, draftId: string, raw: string, markForSignIn = false): void {
  try {
    window.localStorage.setItem(draftStorageKey(email, draftId), raw);
    window.localStorage.setItem(activeDraftStorageKey(email), draftId);
    writeIndex(email, [...readIndex(email), draftId]);
    if (!email && markForSignIn) window.localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ draftId, markedAt: Date.now() }));
  } catch { /* Browser storage is a convenience layer, never the legal record. */ }
}

export function readProjectDraft(email: string | null | undefined, draftId: string): string | null {
  try { return window.localStorage.getItem(draftStorageKey(email, draftId)); }
  catch { return null; }
}

export function removeProjectDraft(email: string | null | undefined, draftId: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(email, draftId));
    const remaining = readIndex(email).filter((id) => id !== draftId);
    writeIndex(email, remaining);
    if (activeDraftId(email) === draftId) {
      const next = remaining.at(-1);
      if (next) window.localStorage.setItem(activeDraftStorageKey(email), next);
      else window.localStorage.removeItem(activeDraftStorageKey(email));
    }
  } catch { /* best-effort browser cleanup */ }
}

export function claimPendingAnonymousDraft(email: string): { draftId: string; raw: string } | null {
  try {
    const pending = JSON.parse(window.localStorage.getItem(PENDING_CLAIM_KEY) ?? "null") as { draftId?: unknown; markedAt?: unknown } | null;
    if (!pending || typeof pending.draftId !== "string" || typeof pending.markedAt !== "number") return null;
    // A stale marker should never move an old shared-browser draft into a later
    // visitor's account.
    if (Date.now() - pending.markedAt > 24 * 60 * 60_000) {
      window.localStorage.removeItem(PENDING_CLAIM_KEY);
      return null;
    }
    const raw = readProjectDraft(null, pending.draftId);
    window.localStorage.removeItem(PENDING_CLAIM_KEY);
    if (!raw) return null;
    saveProjectDraft(email, pending.draftId, raw);
    removeProjectDraft(null, pending.draftId);
    return { draftId: pending.draftId, raw };
  } catch { return null; }
}

export function clearLegacyGlobalDraftState(): void {
  try {
    for (const key of LEGACY_GLOBAL_KEYS) window.localStorage.removeItem(key);
  } catch { /* best-effort browser cleanup */ }
}

export function clearAccountDraftState(email: string | null | undefined): void {
  try {
    for (const draftId of readIndex(email)) window.localStorage.removeItem(draftStorageKey(email, draftId));
    window.localStorage.removeItem(draftIndexKey(email));
    window.localStorage.removeItem(activeDraftStorageKey(email));
    window.localStorage.removeItem(legacyDraftStorageKey(email));
    if (!email) window.localStorage.removeItem(PENDING_CLAIM_KEY);
  } catch { /* best-effort browser cleanup */ }
  clearLegacyGlobalDraftState();
}
