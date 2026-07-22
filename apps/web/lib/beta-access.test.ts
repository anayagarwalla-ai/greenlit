import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMock = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("./database", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: databaseMock.maybeSingle }) }) }),
  }),
}));

import { adminAccessAllowed, betaAccessAllowed, betaAccessAllowedFresh, betaEmailAllowed } from "./beta-access";

describe("betaEmailAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed in production when no allowlist is configured, regardless of email", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETA_ALLOWED_EMAILS", "");
    expect(betaEmailAllowed("anyone@example.com")).toBe(false);
    expect(betaEmailAllowed(undefined)).toBe(false);
  });

  it("allows any email in non-production when no allowlist is configured (local dev convenience)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETA_ALLOWED_EMAILS", "");
    expect(betaEmailAllowed("anyone@example.com")).toBe(true);
  });

  it("only allows exact emails on the configured allowlist, case-insensitively and trimmed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETA_ALLOWED_EMAILS", " Agency@Example.com ,other@example.com");
    expect(betaEmailAllowed("agency@example.com")).toBe(true);
    expect(betaEmailAllowed("AGENCY@EXAMPLE.COM")).toBe(true);
    expect(betaEmailAllowed("other@example.com")).toBe(true);
    expect(betaEmailAllowed("not-invited@example.com")).toBe(false);
    expect(betaEmailAllowed(null)).toBe(false);
    expect(betaEmailAllowed(undefined)).toBe(false);
  });

  it("does not allow a substring or prefix match of an allowed email", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETA_ALLOWED_EMAILS", "agency@example.com");
    expect(betaEmailAllowed("agency@example.com.evil.test")).toBe(false);
    expect(betaEmailAllowed("notagency@example.com")).toBe(false);
  });
});

describe("betaAccessAllowed (Supabase user shape)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("derives access from the user's email through the same allowlist logic", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETA_ALLOWED_EMAILS", "agency@example.com");
    expect(betaAccessAllowed({ email: "agency@example.com" })).toBe(true);
    expect(betaAccessAllowed({ email: "removed-tester@example.com" })).toBe(false);
  });
});

describe("adminAccessAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires an explicit ADMIN_EMAILS allowlist match; an empty allowlist denies everyone", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(adminAccessAllowed({ email: "anyone@example.com" })).toBe(false);
  });

  it("allows only emails on the ADMIN_EMAILS list, case-insensitively", () => {
    vi.stubEnv("ADMIN_EMAILS", "Operator@Example.com");
    expect(adminAccessAllowed({ email: "operator@example.com" })).toBe(true);
    expect(adminAccessAllowed({ email: "someone-else@example.com" })).toBe(false);
  });

  it("being on the beta allowlist does not imply admin access", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETA_ALLOWED_EMAILS", "agency@example.com");
    vi.stubEnv("ADMIN_EMAILS", "operator@example.com");
    expect(betaEmailAllowed("agency@example.com")).toBe(true);
    expect(adminAccessAllowed({ email: "agency@example.com" })).toBe(false);
  });
});

describe("durable beta invitations", () => {
  beforeEach(() => {
    vi.stubEnv("BETA_ALLOWED_EMAILS", "invited@example.test");
    databaseMock.maybeSingle.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("treats an INVITED reservation as blocked until provisioning activates it", async () => {
    databaseMock.maybeSingle.mockResolvedValue({ data: { status: "INVITED" }, error: null });
    await expect(betaAccessAllowedFresh("invited@example.test")).resolves.toBe(false);
  });

  it("allows a durable ACTIVE invitation", async () => {
    databaseMock.maybeSingle.mockResolvedValue({ data: { status: "ACTIVE" }, error: null });
    await expect(betaAccessAllowedFresh("invited@example.test")).resolves.toBe(true);
  });

  it("uses the configured allowlist only when no durable row exists", async () => {
    databaseMock.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(betaAccessAllowedFresh("invited@example.test")).resolves.toBe(true);
  });
});
