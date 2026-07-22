import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANONYMOUS_DRAFT_TTL_MS,
  activeDraftId,
  claimPendingAnonymousDraft,
  clearAccountDraftState,
  clearLegacyGlobalDraftState,
  draftStorageKey,
  flushProjectDraftOnPageHide,
  isDraftStorageAvailable,
  legacyDraftStorageKey,
  purgeExpiredAnonymousDrafts,
  readProjectDraft,
  readProjectDraftSavedAt,
  saveProjectDraft,
  signOutAndClearDraftState,
} from "./client-storage";

class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
  keys() { return [...this.store.keys()]; }
}
(globalThis as unknown as { window: { localStorage: FakeStorage } }).window = { localStorage: new FakeStorage() };
const fakeStorage = () => (window.localStorage as unknown as FakeStorage);

describe("project draft storage", () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it("isolates drafts by account and project", () => {
    saveProjectDraft("agency@example.com", "project-a", "draft-a");
    saveProjectDraft("agency@example.com", "project-b", "draft-b");
    saveProjectDraft("other@example.com", "project-a", "other-draft");
    expect(readProjectDraft("agency@example.com", "project-a")).toBe("draft-a");
    expect(readProjectDraft("agency@example.com", "project-b")).toBe("draft-b");
    expect(readProjectDraft("other@example.com", "project-a")).toBe("other-draft");
    expect(activeDraftId("agency@example.com")).toBe("project-b");
  });

  it("timestamps signed-in drafts so a newer local copy can win resume conflict resolution", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_234_567);
    saveProjectDraft("agency@example.com", "project-a", "newer-local-draft");
    expect(readProjectDraftSavedAt("agency@example.com", "project-a")).toBe(1_234_567);
  });

  it("moves only an explicitly marked anonymous draft into the signed-in account", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "pending-project", "pending-draft", true);
    saveProjectDraft(null, "unrelated-project", "unrelated-draft");
    const claimed = claimPendingAnonymousDraft("agency@example.com");
    expect(claimed).toEqual({ draftId: "pending-project", raw: "pending-draft" });
    expect(readProjectDraft("agency@example.com", "pending-project")).toBe("pending-draft");
    expect(readProjectDraft(null, "pending-project")).toBeNull();
    expect(readProjectDraft(null, "unrelated-project")).toBe("unrelated-draft");
  });

  it("keeps the only anonymous copy when an account-scoped handoff save fails", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "pending-project", "pending-draft", true);
    const originalSetItem = fakeStorage().setItem.bind(fakeStorage());
    vi.spyOn(fakeStorage(), "setItem").mockImplementation((key, value) => {
      if (key.startsWith("greenlit-draft-v4:agency@example.com:")) throw new DOMException("QuotaExceededError");
      originalSetItem(key, value);
    });
    expect(claimPendingAnonymousDraft("agency@example.com")).toBeNull();
    expect(readProjectDraft(null, "pending-project")).toBe("pending-draft");
  });

  it("does not claim a stale shared-browser draft and purges the expired draft content", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "old-project", "old-draft", true);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + ANONYMOUS_DRAFT_TTL_MS + 1);
    expect(claimPendingAnonymousDraft("agency@example.com")).toBeNull();
    // The 24-hour window expires the draft itself, not only the sign-in marker.
    expect(readProjectDraft(null, "old-project")).toBeNull();
    expect(window.localStorage.getItem(draftStorageKey(null, "old-project"))).toBeNull();
  });

  it("keeps an anonymous draft readable inside the 24-hour window", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "fresh-project", "fresh-draft");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + ANONYMOUS_DRAFT_TTL_MS - 1);
    expect(readProjectDraft(null, "fresh-project")).toBe("fresh-draft");
  });

  it("does not let pagehide flushing revive an expired anonymous draft", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "old-project", "sensitive-sow");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + ANONYMOUS_DRAFT_TTL_MS + 1);
    expect(flushProjectDraftOnPageHide(null, "old-project", "sensitive-sow")).toBe(false);
    expect(window.localStorage.getItem(draftStorageKey(null, "old-project"))).toBeNull();
  });

  it("pagehide flushing still stores a brand-new anonymous draft", () => {
    expect(flushProjectDraftOnPageHide(null, "new-project", "new-sow")).toBe(true);
    expect(readProjectDraft(null, "new-project")).toBe("new-sow");
  });

  it("purgeExpiredAnonymousDrafts removes only expired anonymous drafts", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "expired-project", "expired-draft");
    saveProjectDraft("agency@example.com", "account-project", "account-draft");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + ANONYMOUS_DRAFT_TTL_MS + 1);
    saveProjectDraft(null, "recent-project", "recent-draft");
    purgeExpiredAnonymousDrafts();
    expect(window.localStorage.getItem(draftStorageKey(null, "expired-project"))).toBeNull();
    expect(readProjectDraft(null, "recent-project")).toBe("recent-draft");
    // Signed-in drafts are account-scoped and retained; only anonymous drafts age out.
    expect(readProjectDraft("agency@example.com", "account-project")).toBe("account-draft");
  });

  it("treats an anonymous draft with no timestamp as expired instead of keeping it forever", () => {
    saveProjectDraft(null, "untimed-project", "untimed-draft");
    for (const key of fakeStorage().keys()) if (key.startsWith("greenlit-draft-saved-")) window.localStorage.removeItem(key);
    expect(readProjectDraft(null, "untimed-project")).toBeNull();
  });

  it("purges an untimestamped legacy anonymous draft instead of re-dating it", () => {
    window.localStorage.setItem(legacyDraftStorageKey(null), "legacy-anonymous-sow");
    purgeExpiredAnonymousDrafts();
    expect(window.localStorage.getItem(legacyDraftStorageKey(null))).toBeNull();
  });

  it("reports a failed save instead of pretending the draft was stored", () => {
    expect(saveProjectDraft("agency@example.com", "ok-project", "ok-draft")).toBe(true);
    vi.spyOn(fakeStorage(), "setItem").mockImplementation(() => { throw new DOMException("QuotaExceededError"); });
    expect(saveProjectDraft("agency@example.com", "failing-project", "failing-draft")).toBe(false);
    expect(isDraftStorageAvailable()).toBe(false);
  });

  it("detects available storage", () => {
    expect(isDraftStorageAvailable()).toBe(true);
  });

  it("clearAccountDraftState removes every project for only that account", () => {
    saveProjectDraft("agency-a@example.com", "a-1", "draft-a1");
    saveProjectDraft("agency-a@example.com", "a-2", "draft-a2");
    saveProjectDraft("agency-b@example.com", "b-1", "draft-b1");
    clearAccountDraftState("agency-a@example.com");
    expect(readProjectDraft("agency-a@example.com", "a-1")).toBeNull();
    expect(readProjectDraft("agency-a@example.com", "a-2")).toBeNull();
    expect(readProjectDraft("agency-b@example.com", "b-1")).toBe("draft-b1");
  });

  it("sign-out clears the account draft only after the server ends the session", async () => {
    saveProjectDraft("agency@example.com", "proj-1", "draft-content");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(signOutAndClearDraftState("agency@example.com")).resolves.toBe(true);
    expect(readProjectDraft("agency@example.com", "proj-1")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("a failed sign-out preserves the local draft", async () => {
    saveProjectDraft("agency@example.com", "proj-1", "draft-content");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(signOutAndClearDraftState("agency@example.com")).resolves.toBe(false);
    expect(readProjectDraft("agency@example.com", "proj-1")).toBe("draft-content");
    vi.unstubAllGlobals();
  });

  it("a network error during sign-out propagates and preserves the local draft", async () => {
    saveProjectDraft("agency@example.com", "proj-1", "draft-content");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(signOutAndClearDraftState("agency@example.com")).rejects.toThrow();
    expect(readProjectDraft("agency@example.com", "proj-1")).toBe("draft-content");
    vi.unstubAllGlobals();
  });

  it("keeps account keys case-insensitive and clears legacy bearer-token keys", () => {
    expect(draftStorageKey(" Agency@Example.com ", "one")).toBe(draftStorageKey("agency@example.com", "one"));
    window.localStorage.setItem("greenlit-workspace-draft-v2", "legacy");
    window.localStorage.setItem("greenlit-approved-url", "https://example.test/review/PACKET#t=secret");
    clearLegacyGlobalDraftState();
    expect(window.localStorage.getItem("greenlit-workspace-draft-v2")).toBeNull();
    expect(window.localStorage.getItem("greenlit-approved-url")).toBeNull();
  });
});
