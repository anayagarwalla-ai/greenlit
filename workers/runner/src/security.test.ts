import { describe, expect, it } from "vitest";
import { addressMatchesFrozenSet, isUnsafeAddress, pathWithQueryAndHash, perCheckBudgetMs } from "./security";

describe("isUnsafeAddress", () => {
  it("blocks loopback, private, link-local, and metadata IPv4 ranges", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "172.16.4.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "198.18.0.1"]) {
      expect(isUnsafeAddress(address), address).toBe(true);
    }
  });

  it("blocks loopback, unique-local, and link-local IPv6 ranges", () => {
    for (const address of ["::1", "::", "fc00::1", "fd00::1", "fe80::1"]) {
      expect(isUnsafeAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public IPv4 and IPv6 addresses", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isUnsafeAddress(address), address).toBe(false);
    }
  });

  it("treats malformed/non-IP input as unsafe by default", () => {
    expect(isUnsafeAddress("not-an-ip")).toBe(true);
    expect(isUnsafeAddress("")).toBe(true);
  });
});

describe("pathWithQueryAndHash", () => {
  it("includes the query string and fragment, not just the bare path", () => {
    expect(pathWithQueryAndHash(new URL("https://example.test/thanks?id=42#confirmed"))).toBe("/thanks?id=42#confirmed");
  });

  it("returns just the path when there is no query or fragment", () => {
    expect(pathWithQueryAndHash(new URL("https://example.test/thanks"))).toBe("/thanks");
  });

  it("distinguishes two paths that only differ by query string", () => {
    const withQuery = pathWithQueryAndHash(new URL("https://example.test/contact?sent=1"));
    const withoutQuery = pathWithQueryAndHash(new URL("https://example.test/contact"));
    expect(withQuery).not.toBe(withoutQuery);
  });
});

describe("addressMatchesFrozenSet", () => {
  it("accepts only a safe address frozen when the job was queued", () => {
    expect(addressMatchesFrozenSet("93.184.216.34", ["93.184.216.34", "2606:4700:4700::1111"])).toBe(true);
    expect(addressMatchesFrozenSet("93.184.216.35", ["93.184.216.34"])).toBe(false);
    expect(addressMatchesFrozenSet("127.0.0.1", ["127.0.0.1"])).toBe(false);
  });
});

describe("perCheckBudgetMs", () => {
  it("shares the remaining job time across every unfinished check", () => {
    expect(perCheckBudgetMs(48_000, 0, 6)).toBe(8_000);
    expect(perCheckBudgetMs(48_000, 18_000, 3)).toBe(10_000);
  });

  it("caps a single check and fails closed for invalid input", () => {
    expect(perCheckBudgetMs(60_000, 0, 1)).toBe(18_000);
    expect(perCheckBudgetMs(10_000, 11_000, 1)).toBe(0);
    expect(perCheckBudgetMs(10_000, 0, 0)).toBe(0);
  });
});
