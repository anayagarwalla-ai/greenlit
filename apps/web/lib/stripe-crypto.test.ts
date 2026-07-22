import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptStripeSecret, encryptStripeSecret } from "./stripe-crypto";

const previous = process.env.STRIPE_TOKEN_ENCRYPTION_KEY;

describe("Stripe token encryption", () => {
  beforeEach(() => { process.env.STRIPE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); });
  afterEach(() => { if (previous === undefined) delete process.env.STRIPE_TOKEN_ENCRYPTION_KEY; else process.env.STRIPE_TOKEN_ENCRYPTION_KEY = previous; });

  it("round-trips an OAuth token without storing plaintext", () => {
    const encrypted = encryptStripeSecret("sk_test_sensitive");
    expect(encrypted).not.toContain("sk_test_sensitive");
    expect(decryptStripeSecret(encrypted)).toBe("sk_test_sensitive");
  });

  it("fails closed when ciphertext is modified", () => {
    const segments = encryptStripeSecret("token").split(".");
    const tag = segments[3];
    if (!tag) throw new Error("Encrypted token did not contain an authentication tag.");
    segments[3] = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    expect(() => decryptStripeSecret(segments.join("."))).toThrow();
  });
});
