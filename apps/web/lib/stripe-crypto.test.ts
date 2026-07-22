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
    const encrypted = encryptStripeSecret("token");
    expect(() => decryptStripeSecret(`${encrypted.slice(0, -1)}x`)).toThrow();
  });
});
