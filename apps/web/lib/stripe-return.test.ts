import { describe, expect, it } from "vitest";
import {
  parseStripeReturn,
  STRIPE_RETURN_STATES,
  stripeConnectionActionLabel,
} from "./stripe-return";

describe("Stripe dashboard return states", () => {
  it.each(STRIPE_RETURN_STATES)("maps and consumes the documented %s state", (state) => {
    const parsed = parseStripeReturn(`https://greenlit.example/dashboard?stripe=${state}`);

    expect(parsed).not.toBeNull();
    expect(parsed?.notice.message.length).toBeGreaterThan(20);
    expect(parsed?.notice.kind).toBe(
      state === "connected" ? "success" : state === "cancelled" ? "info" : "error",
    );
    expect(parsed?.cleanPath).toBe("/dashboard");
  });

  it("treats duplicate return values as ambiguous and removes all of them", () => {
    const parsed = parseStripeReturn(
      "https://greenlit.example/dashboard?record=MP-1&stripe=connected&stripe=failed#billing",
    );

    expect(parsed?.cleanPath).toBe("/dashboard?record=MP-1#billing");
    expect(parsed?.notice.kind).toBe("error");
    expect(parsed?.notice.message).toContain("unrecognized");
  });

  it("consumes unknown states with safe generic feedback", () => {
    const parsed = parseStripeReturn("https://greenlit.example/dashboard?stripe=future-state");

    expect(parsed?.notice.kind).toBe("error");
    expect(parsed?.notice.message).toContain("unrecognized");
    expect(parsed?.cleanPath).toBe("/dashboard");
  });

  it("does nothing when the dashboard has no Stripe return parameter", () => {
    expect(parseStripeReturn("https://greenlit.example/dashboard?record=MP-1")).toBeNull();
  });

  it("uses the reconnect label when Stripe requires fresh authorization", () => {
    expect(stripeConnectionActionLabel("REAUTH_REQUIRED")).toBe("Reconnect Stripe");
    expect(stripeConnectionActionLabel("DISCONNECTED")).toBe("Connect Stripe");
    expect(stripeConnectionActionLabel(null)).toBe("Connect Stripe");
  });
});
