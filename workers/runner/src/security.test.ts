import { describe, expect, it } from "vitest";
import { isUnsafeAddress, pathWithQueryAndHash } from "./security";

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
