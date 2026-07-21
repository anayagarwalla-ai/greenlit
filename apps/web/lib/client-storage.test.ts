import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeDraftId,
  claimPendingAnonymousDraft,
  clearAccountDraftState,
  clearLegacyGlobalDraftState,
  draftStorageKey,
  readProjectDraft,
  saveProjectDraft,
} from "./client-storage";

class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { window: { localStorage: FakeStorage } }).window = { localStorage: new FakeStorage() };

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

  it("does not claim a stale shared-browser draft", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    saveProjectDraft(null, "old-project", "old-draft", true);
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + 24 * 60 * 60_000 + 1);
    expect(claimPendingAnonymousDraft("agency@example.com")).toBeNull();
    expect(readProjectDraft(null, "old-project")).toBe("old-draft");
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

  it("keeps account keys case-insensitive and clears legacy bearer-token keys", () => {
    expect(draftStorageKey(" Agency@Example.com ", "one")).toBe(draftStorageKey("agency@example.com", "one"));
    window.localStorage.setItem("milestoneproof-workspace-draft-v2", "legacy");
    window.localStorage.setItem("milestoneproof-approved-url", "https://example.test/review/PACKET#t=secret");
    clearLegacyGlobalDraftState();
    expect(window.localStorage.getItem("milestoneproof-workspace-draft-v2")).toBeNull();
    expect(window.localStorage.getItem("milestoneproof-approved-url")).toBeNull();
  });
});
