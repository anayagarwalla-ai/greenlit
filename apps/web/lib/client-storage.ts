"use client";

// Client-side browser-storage keys. Every key that can hold account- or
// project-specific state (drafts) is namespaced by the signed-in email so a
// second agency on the same browser never inherits the first agency's SOW,
// business details, or in-progress project. Client bearer/review tokens are
// never written to any of these keys — only the non-secret review packet id.
const LEGACY_GLOBAL_KEYS = [
  "milestoneproof-workspace-draft-v2",
  "milestoneproof-approved-url",
  "milestoneproof-demo-decision",
];

export function draftStorageKey(email: string | null | undefined): string {
  return `milestoneproof-draft-v3:${(email || "anon").trim().toLowerCase()}`;
}

export function clearLegacyGlobalDraftState(): void {
  try {
    for (const key of LEGACY_GLOBAL_KEYS) window.localStorage.removeItem(key);
  } catch { /* best-effort browser cleanup */ }
}

export function clearAccountDraftState(email: string | null | undefined): void {
  try {
    window.localStorage.removeItem(draftStorageKey(email));
  } catch { /* best-effort browser cleanup */ }
  clearLegacyGlobalDraftState();
}
