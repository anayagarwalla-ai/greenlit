import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, publicRecordId, requestActorHash, sha256 } from "./recordkeeping";

afterEach(() => vi.unstubAllEnvs());

describe("recordkeeping primitives", () => {
  it("canonicalizes nested object keys without changing array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] }))
      .toBe('{"a":{"b":3,"y":2},"list":[{"c":5,"d":4}],"z":1}');
  });

  it("produces a stable SHA-256 digest", () => {
    expect(sha256("Greenlit")).toBe("a6dfce4195d15641e5fe81dfc1b5d6939b0d22e684ac823f1bdbcdb44b3fb9fa");
  });

  it("uses a keyed, deterministic actor hash instead of retaining raw request metadata", () => {
    vi.stubEnv("RECORD_HASH_SECRET", "unit-test-record-secret");
    const request = new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.4", "x-vercel-ip-country": "US", "user-agent": "Greenlit test" } });
    const first = requestActorHash(request);
    expect(first).toBe(requestActorHash(request));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("203.0.113.4");
  });

  it("creates opaque, human-readable public record identifiers", () => {
    expect(publicRecordId("MP")).toMatch(/^MP-[A-F0-9]{10}$/);
  });
});
