import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRateLimit, positiveIntegerSetting } from "./rate-limit";

describe("beta capacity settings", () => {
  it("accepts positive safe integers", () => {
    expect(positiveIntegerSetting("25", 20)).toBe(25);
    expect(positiveIntegerSetting("20", 8, 20)).toBe(20);
  });

  it("falls back for missing, malformed, fractional, or non-positive values", () => {
    expect(positiveIntegerSetting(undefined, 20)).toBe(20);
    expect(positiveIntegerSetting("oops", 20)).toBe(20);
    expect(positiveIntegerSetting("2.5", 20)).toBe(20);
    expect(positiveIntegerSetting("0", 20)).toBe(20);
    expect(positiveIntegerSetting("-1", 20)).toBe(20);
    expect(positiveIntegerSetting("21", 8, 20)).toBe(8);
  });
});

describe("consumeRateLimit fail-closed behavior on protected routes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed in production when the quota store is not configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const request = new Request("https://example.test/api/runs");
    const result = await consumeRateLimit(request, "verification-run-day", 8, 86_400, "user-1", { failClosed: true });
    expect(result.allowed).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it("stays fail-open in local development when the quota store is simply not configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const request = new Request("https://example.test/api/runs");
    const result = await consumeRateLimit(request, "verification-run-day", 8, 86_400, "user-1", { failClosed: true });
    expect(result.allowed).toBe(true);
  });

  it("defaults to fail-closed in production when failClosed is not specified", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const request = new Request("https://example.test/api/feedback");
    const result = await consumeRateLimit(request, "beta-feedback-day", 10, 86_400, "user-1");
    expect(result.allowed).toBe(false);
    expect(result.unavailable).toBe(true);
  });
});
