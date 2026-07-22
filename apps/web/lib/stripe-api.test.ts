import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verifyStripeWebhook } from "./stripe-api";

const previous = process.env.STRIPE_WEBHOOK_SECRET;

afterEach(() => { if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previous; });

describe("Stripe webhook verification", () => {
  it("accepts a current v1 signature and rejects tampering or replay", () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const timestamp = 2_000_000_000;
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${body}`).digest("hex");
    expect(verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`, timestamp)).toBe(true);
    expect(verifyStripeWebhook(`${body}x`, `t=${timestamp},v1=${signature}`, timestamp)).toBe(false);
    expect(verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`, timestamp + 301)).toBe(false);
  });
});
