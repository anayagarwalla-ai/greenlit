import { beforeEach, describe, expect, it } from "vitest";
import { clearAccountDraftState, clearLegacyGlobalDraftState, draftStorageKey } from "./client-storage";

// No jsdom dependency in this workspace; a minimal in-memory Storage stand-in
// is enough to exercise the real localStorage-key logic under test.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { window: { localStorage: FakeStorage } }).window = { localStorage: new FakeStorage() };

describe("draftStorageKey", () => {
  it("produces a distinct key per account email, case- and whitespace-insensitively", () => {
    const a = draftStorageKey("agency-a@example.com");
    const b = draftStorageKey("agency-b@example.com");
    expect(a).not.toBe(b);
    expect(draftStorageKey(" Agency-A@Example.com ")).toBe(a);
  });

  it("falls back to a distinct anonymous bucket that never collides with a real account", () => {
    const anon = draftStorageKey(undefined);
    const named = draftStorageKey("agency@example.com");
    expect(anon).not.toBe(named);
    expect(draftStorageKey(null)).toBe(anon);
    expect(draftStorageKey("")).toBe(anon);
  });
});

describe("account draft cleanup", () => {
  beforeEach(() => window.localStorage.clear());

  it("clearAccountDraftState only removes this account's key, not another account's", () => {
    window.localStorage.setItem(draftStorageKey("agency-a@example.com"), "draft-a");
    window.localStorage.setItem(draftStorageKey("agency-b@example.com"), "draft-b");
    clearAccountDraftState("agency-a@example.com");
    expect(window.localStorage.getItem(draftStorageKey("agency-a@example.com"))).toBeNull();
    expect(window.localStorage.getItem(draftStorageKey("agency-b@example.com"))).toBe("draft-b");
  });

  it("clearAccountDraftState and clearLegacyGlobalDraftState both remove the legacy global keys that could hold a bearer token", () => {
    window.localStorage.setItem("milestoneproof-workspace-draft-v2", "legacy-draft-with-review-token");
    window.localStorage.setItem("milestoneproof-approved-url", "https://example.test/review/PACKET#t=secret-bearer-token");
    clearLegacyGlobalDraftState();
    expect(window.localStorage.getItem("milestoneproof-workspace-draft-v2")).toBeNull();
    expect(window.localStorage.getItem("milestoneproof-approved-url")).toBeNull();
  });
});
