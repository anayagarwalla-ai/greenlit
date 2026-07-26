export const STRIPE_RETURN_STATES = [
  "connected",
  "cancelled",
  "session-expired",
  "invalid-state",
  "failed",
  "cross-site-blocked",
  "rate-limited",
  "not-configured",
  "state-failed",
] as const;

export type StripeReturnState = (typeof STRIPE_RETURN_STATES)[number];

export type StripeReturnNotice = {
  kind: "success" | "info" | "error";
  message: string;
};

const notices: Record<StripeReturnState, StripeReturnNotice> = {
  connected: {
    kind: "success",
    message: "Stripe connected successfully. Billing setup is now available for eligible milestones.",
  },
  cancelled: {
    kind: "info",
    message: "Stripe connection was cancelled. No Stripe connection changes were made.",
  },
  "session-expired": {
    kind: "error",
    message: "Your Greenlit session expired before Stripe returned. Sign in again, then reconnect Stripe.",
  },
  "invalid-state": {
    kind: "error",
    message: "Greenlit could not verify this Stripe connection attempt. Start a new connection from the dashboard.",
  },
  failed: {
    kind: "error",
    message: "Stripe could not be connected. Check the current connection status, then try again or contact the beta operator.",
  },
  "cross-site-blocked": {
    kind: "error",
    message: "Stripe setup was blocked because it was opened from another site. Start it from this dashboard.",
  },
  "rate-limited": {
    kind: "error",
    message: "Too many Stripe connection attempts were made. Wait before trying again.",
  },
  "not-configured": {
    kind: "error",
    message: "Stripe connection is not configured for this Greenlit deployment. Ask the beta operator to enable it.",
  },
  "state-failed": {
    kind: "error",
    message: "Greenlit could not create the secure Stripe connection request. Try again; no account was connected.",
  },
};

export function parseStripeReturn(href: string) {
  const url = new URL(href);
  if (!url.searchParams.has("stripe")) return null;
  const states = url.searchParams.getAll("stripe");
  const state = states.length === 1 ? states[0] : "";
  const notice = notices[state as StripeReturnState] ?? {
    kind: "error" as const,
    message: "Greenlit received an unrecognized Stripe connection result. Check the connection status before trying again.",
  };
  url.searchParams.delete("stripe");
  return {
    notice,
    cleanPath: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function stripeConnectionActionLabel(status?: string | null) {
  return status === "REAUTH_REQUIRED" ? "Reconnect Stripe" : "Connect Stripe";
}
