"use client";

import { fetchWithTimeout } from "./client-request";

// Browser drafts are isolated by both account and project. Review bearer
// tokens are never persisted here; only non-secret packet ids may appear in a
// workspace snapshot.
const DRAFT_VERSION = "v4";
const LEGACY_GLOBAL_KEYS = [
  "greenlit-workspace-draft-v2",
  "greenlit-approved-url",
  "greenlit-demo-decision",
];
const PENDING_CLAIM_KEY = `greenlit-pending-draft-claim-${DRAFT_VERSION}`;
// An unsigned draft on a shared browser can be read by the next person at the
// keyboard, so it is purged after this window, which is the same window the sign-in
// handoff marker already used.
export const ANONYMOUS_DRAFT_TTL_MS = 30 * 60_000;

function ownerKey(email: string | null | undefined): string {
  return (email || "anon").trim().toLowerCase() || "anon";
}

function isAnonymousOwner(email: string | null | undefined): boolean {
  return ownerKey(email) === "anon";
}

function storageFor(email: string | null | undefined): Storage {
  // Unsigned SOWs survive the same-tab magic-link navigation, but are never
  // written into durable, shared-browser localStorage.
  return isAnonymousOwner(email) ? window.sessionStorage : window.localStorage;
}

function draftIndexKey(email: string | null | undefined): string {
  return `greenlit-draft-index-${DRAFT_VERSION}:${ownerKey(email)}`;
}

export function activeDraftStorageKey(email: string | null | undefined): string {
  return `greenlit-active-draft-${DRAFT_VERSION}:${ownerKey(email)}`;
}

export function legacyDraftStorageKey(email: string | null | undefined): string {
  return `greenlit-draft-v3:${ownerKey(email)}`;
}

export function draftStorageKey(email: string | null | undefined, draftId = "default"): string {
  return `greenlit-draft-${DRAFT_VERSION}:${ownerKey(email)}:${draftId}`;
}

function draftSavedAtKey(email: string | null | undefined, draftId: string): string {
  return `greenlit-draft-saved-${DRAFT_VERSION}:${ownerKey(email)}:${draftId}`;
}

export function readProjectDraftSavedAt(email: string | null | undefined, draftId: string): number | null {
  try {
    const value = Number(storageFor(email).getItem(draftSavedAtKey(email, draftId)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

function readIndex(email: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(storageFor(email).getItem(draftIndexKey(email)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function writeIndex(email: string | null | undefined, ids: string[]): void {
  storageFor(email).setItem(draftIndexKey(email), JSON.stringify([...new Set(ids)]));
}

export function activeDraftId(email: string | null | undefined): string | null {
  try { return storageFor(email).getItem(activeDraftStorageKey(email)); }
  catch { return null; }
}

export function isDraftStorageAvailable(): boolean {
  try {
    const probe = `greenlit-storage-probe-${DRAFT_VERSION}`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch { return false; }
}

function anonymousDraftExpired(draftId: string): boolean {
    const savedAtRaw = storageFor(null).getItem(draftSavedAtKey(null, draftId));
  const savedAt = Number(savedAtRaw);
  // An anonymous draft with no readable timestamp has an unknown age on a
  // possibly shared browser; treat it as expired rather than keep it forever.
  if (!savedAtRaw || !Number.isFinite(savedAt)) return true;
  return Date.now() - savedAt > ANONYMOUS_DRAFT_TTL_MS;
}

/**
 * Persists a draft. Returns false, instead of silently pretending the draft
 * was saved, when the browser rejects the write (quota, private mode,
 * blocked storage). Callers surface that honestly.
 */
export function saveProjectDraft(email: string | null | undefined, draftId: string, raw: string, markForSignIn = false): boolean {
  try {
    const storage = storageFor(email);
    storage.setItem(draftStorageKey(email, draftId), raw);
    // Retained-workspace restore compares this timestamp with the server
    // record's updated_at value. Account-scoped drafts need the timestamp just
    // as much as anonymous drafts; otherwise a newer local copy can never win
    // after a failed/aborted server save.
    storage.setItem(draftSavedAtKey(email, draftId), String(Date.now()));
    storage.setItem(activeDraftStorageKey(email), draftId);
    writeIndex(email, [...readIndex(email), draftId]);
    if (isAnonymousOwner(email) && markForSignIn) window.sessionStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ draftId, markedAt: Date.now(), boundEmail: null }));
    return true;
  } catch { return false; /* Browser storage is a convenience layer, never the legal record. */ }
}

/**
 * Flushes the latest in-memory snapshot while the page is leaving, without
 * allowing a navigation event to refresh an already-expired anonymous draft.
 * A brand-new, not-yet-saved draft is still eligible for this last write.
 */
export function flushProjectDraftOnPageHide(email: string | null | undefined, draftId: string, raw: string): boolean {
  try {
    const existing = storageFor(email).getItem(draftStorageKey(email, draftId));
    if (isAnonymousOwner(email) && existing !== null && anonymousDraftExpired(draftId)) {
      removeProjectDraft(email, draftId);
      return false;
    }
  } catch { return false; }
  return saveProjectDraft(email, draftId, raw);
}

export function readProjectDraft(email: string | null | undefined, draftId: string): string | null {
  try {
    if (isAnonymousOwner(email) && anonymousDraftExpired(draftId)) {
      removeProjectDraft(null, draftId);
      return null;
    }
    return storageFor(email).getItem(draftStorageKey(email, draftId));
  }
  catch { return null; }
}

export function removeProjectDraft(email: string | null | undefined, draftId: string): void {
  try {
    const storage = storageFor(email);
    storage.removeItem(draftStorageKey(email, draftId));
    storage.removeItem(draftSavedAtKey(email, draftId));
    const remaining = readIndex(email).filter((id) => id !== draftId);
    writeIndex(email, remaining);
    if (activeDraftId(email) === draftId) {
      const next = remaining.at(-1);
      if (next) storage.setItem(activeDraftStorageKey(email), next);
      else storage.removeItem(activeDraftStorageKey(email));
    }
  } catch { /* best-effort browser cleanup */ }
}

/**
 * Deletes every anonymous draft older than the 30-minute retention window, the
 * draft content itself, not only the sign-in handoff marker.
 */
export function purgeExpiredAnonymousDrafts(): void {
  try {
    // v3 anonymous drafts predate per-draft timestamps, so their age cannot be
    // established safely on a shared browser. Do not re-date and resurrect
    // them during migration.
    window.sessionStorage.removeItem(legacyDraftStorageKey(null));
    window.localStorage.removeItem(legacyDraftStorageKey(null));
    for (const draftId of readIndex(null)) {
      if (anonymousDraftExpired(draftId)) removeProjectDraft(null, draftId);
    }
    const pending = JSON.parse(window.sessionStorage.getItem(PENDING_CLAIM_KEY) ?? "null") as { markedAt?: unknown } | null;
    if (pending && (typeof pending.markedAt !== "number" || Date.now() - pending.markedAt > ANONYMOUS_DRAFT_TTL_MS)) {
      window.sessionStorage.removeItem(PENDING_CLAIM_KEY);
    }
  } catch { /* best-effort browser cleanup */ }
}

export function bindPendingAnonymousDraftClaim(email: string): void {
  try {
    const pending = JSON.parse(window.sessionStorage.getItem(PENDING_CLAIM_KEY) ?? "null") as { draftId?: unknown; markedAt?: unknown } | null;
    if (!pending || typeof pending.draftId !== "string" || typeof pending.markedAt !== "number") return;
    window.sessionStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ ...pending, boundEmail: email.trim().toLowerCase() }));
  } catch { /* best-effort sign-in handoff binding */ }
}

export function claimPendingAnonymousDraft(email: string): { draftId: string; raw: string } | null {
  try {
    const pending = JSON.parse(window.sessionStorage.getItem(PENDING_CLAIM_KEY) ?? "null") as { draftId?: unknown; markedAt?: unknown; boundEmail?: unknown } | null;
    if (!pending || typeof pending.draftId !== "string" || typeof pending.markedAt !== "number" || typeof pending.boundEmail !== "string") return null;
    if (pending.boundEmail !== email.trim().toLowerCase()) return null;
    // A stale marker should never move an old shared-browser draft into a later
    // visitor's account.
    if (Date.now() - pending.markedAt > ANONYMOUS_DRAFT_TTL_MS) {
      window.sessionStorage.removeItem(PENDING_CLAIM_KEY);
      return null;
    }
    const raw = readProjectDraft(null, pending.draftId);
    if (!raw) {
      window.sessionStorage.removeItem(PENDING_CLAIM_KEY);
      return null;
    }
    // Return the same-tab draft directly to React. Do not copy the SOW into
    // durable account localStorage; the workspace will persist only its
    // minimized, secret-free metadata after hydration.
    window.sessionStorage.removeItem(PENDING_CLAIM_KEY);
    removeProjectDraft(null, pending.draftId);
    return { draftId: pending.draftId, raw };
  } catch { return null; }
}

export function clearLegacyGlobalDraftState(): void {
  try {
    for (const key of LEGACY_GLOBAL_KEYS) window.localStorage.removeItem(key);
  } catch { /* best-effort browser cleanup */ }
}

/**
 * Ends the server session and clears the account's local drafts. In that
 * order. A failed sign-out (non-2xx or a network error) leaves the local
 * draft untouched so a still-signed-in user does not lose work.
 */
export async function signOutAndClearDraftState(email: string | null | undefined): Promise<boolean> {
  const response = await fetchWithTimeout("/api/account/session", { method: "DELETE" });
  if (!response.ok) return false;
  clearAccountDraftState(email);
  return true;
}

export function clearAccountDraftState(email: string | null | undefined): void {
  try {
    for (const draftId of readIndex(email)) {
      storageFor(email).removeItem(draftStorageKey(email, draftId));
      storageFor(email).removeItem(draftSavedAtKey(email, draftId));
    }
    storageFor(email).removeItem(draftIndexKey(email));
    storageFor(email).removeItem(activeDraftStorageKey(email));
    storageFor(email).removeItem(legacyDraftStorageKey(email));
    if (isAnonymousOwner(email)) window.sessionStorage.removeItem(PENDING_CLAIM_KEY);
  } catch { /* best-effort browser cleanup */ }
  clearLegacyGlobalDraftState();
}
