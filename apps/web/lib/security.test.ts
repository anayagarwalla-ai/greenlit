import { describe, expect, it } from "vitest";
import { assertSafeResolvedAddresses, isPrivateAddress, validateStagingUrl } from "./security";

describe("staging target security", () => {
  it.each(["http://example.com", "https://localhost", "https://127.0.0.1", "https://user:pass@example.com", "https://example.com:8443", "https://app.local"])('rejects %s', (target) => {
    expect(validateStagingUrl(target).ok).toBe(false);
  });
  it("accepts a public HTTPS hostname", () => expect(validateStagingUrl("https://staging.example.com/build-7").ok).toBe(true));
  it.each(["10.0.0.1", "172.16.1.1", "192.168.1.1", "127.0.0.1", "::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "0:0:0:0:0:ffff:0a00:1"])("blocks private or mapped address %s", (address) => expect(isPrivateAddress(address)).toBe(true));
  it("allows a public address", () => expect(isPrivateAddress("8.8.8.8")).toBe(false));
});

describe("assertSafeResolvedAddresses (DNS-resolution-time SSRF guard)", () => {
  it("throws when DNS resolved to zero addresses (would otherwise silently allow an unresolvable/blocked lookup through)", () => {
    expect(() => assertSafeResolvedAddresses([])).toThrow();
  });
  it("throws when any resolved address is private, even if others are public (rebinding / multi-A-record attack)", () => {
    expect(() => assertSafeResolvedAddresses(["93.184.216.34", "127.0.0.1"])).toThrow();
    expect(() => assertSafeResolvedAddresses(["169.254.169.254"])).toThrow();
  });
  it("allows a set of entirely public addresses", () => {
    expect(() => assertSafeResolvedAddresses(["93.184.216.34", "8.8.8.8"])).not.toThrow();
  });
});
