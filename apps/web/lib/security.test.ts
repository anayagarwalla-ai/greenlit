import { describe, expect, it } from "vitest";
import { isPrivateAddress, validateStagingUrl } from "./security";

describe("staging target security", () => {
  it.each(["http://example.com", "https://localhost", "https://127.0.0.1", "https://user:pass@example.com", "https://example.com:8443", "https://app.local"])('rejects %s', (target) => {
    expect(validateStagingUrl(target).ok).toBe(false);
  });
  it("accepts a public HTTPS hostname", () => expect(validateStagingUrl("https://staging.example.com/build-7").ok).toBe(true));
  it.each(["10.0.0.1", "172.16.1.1", "192.168.1.1", "127.0.0.1", "::1", "fd12::1"])("blocks private address %s", (address) => expect(isPrivateAddress(address)).toBe(true));
  it("allows a public address", () => expect(isPrivateAddress("8.8.8.8")).toBe(false));
});

