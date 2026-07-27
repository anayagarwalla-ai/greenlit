import { describe, expect, it } from "vitest";
import { legalLaunchReadiness, operationalLaunchReadiness } from "./launch-readiness";

const complete = {
  NEXT_PUBLIC_OPERATOR_NAME: "Example Operator LLC",
  NEXT_PUBLIC_OPERATOR_ADDRESS: "123 Main Street, Example, CA 90000",
  NEXT_PUBLIC_GOVERNING_LAW: "the laws of California",
  NEXT_PUBLIC_VENUE: "the state and federal courts in Example County, California",
  NEXT_PUBLIC_SUPPORT_EMAIL: "support@example.com",
  NEXT_PUBLIC_SECURITY_EMAIL: "security@example.com",
};

describe("legal beta launch readiness", () => {
  it("requires every public operator and dispute setting", () => {
    expect(legalLaunchReadiness({ ...complete, NEXT_PUBLIC_VENUE: "" })).toEqual({ ok: false, missing: ["NEXT_PUBLIC_VENUE"] });
  });

  it("rejects an invalid public support address", () => {
    expect(legalLaunchReadiness({ ...complete, NEXT_PUBLIC_SUPPORT_EMAIL: "not-an-email" })).toEqual({ ok: false, missing: ["NEXT_PUBLIC_SUPPORT_EMAIL"] });
  });

  it("requires a monitored security contact", () => {
    expect(legalLaunchReadiness({ ...complete, NEXT_PUBLIC_SECURITY_EMAIL: "" })).toEqual({ ok: false, missing: ["NEXT_PUBLIC_SECURITY_EMAIL"] });
    expect(legalLaunchReadiness({ ...complete, NEXT_PUBLIC_SECURITY_EMAIL: "not-an-email" })).toEqual({ ok: false, missing: ["NEXT_PUBLIC_SECURITY_EMAIL"] });
  });

  it("passes a complete configuration", () => {
    expect(legalLaunchReadiness(complete)).toEqual({ ok: true, missing: [] });
  });
});

const operational = {
  NEXT_PUBLIC_APP_URL: "https://proof.example.com",
  BETA_ALLOWED_EMAILS: "tester@example.com",
  ADMIN_EMAILS: "operator@example.com",
  RUNNER_HMAC_SECRET: "rUnner-9PDg3jMe7cVQ4hK2xT8zN6wB5sLa",
  RECORD_HASH_SECRET: "rec0rd-Vt7qL4mK9xN2cP8sW6jD5hF3bZa",
  CRON_SECRET: "cr0n-A8mR5xQ2pV9kL7sD4wN6jH3cBtY",
  CUSTOM_SMTP_CONFIRMED: "true",
  LINK_SCANNER_TEST_CONFIRMED: "true",
  BACKUP_SCHEDULE_CONFIRMED: "true",
  RESTORE_DRILL_CONFIRMED: "true",
  INCIDENT_OWNERS_ASSIGNED: "true",
};

describe("operational beta launch readiness", () => {
  it("requires a production https URL and closed access lists", () => {
    expect(operationalLaunchReadiness({ ...operational, NEXT_PUBLIC_APP_URL: "http://localhost:3000", ADMIN_EMAILS: "" }).missing)
      .toEqual(["NEXT_PUBLIC_APP_URL", "ADMIN_EMAILS"]);
  });

  it("requires distinct workflow secrets", () => {
    expect(operationalLaunchReadiness({ ...operational, CRON_SECRET: operational.RECORD_HASH_SECRET }).missing)
      .toEqual(["SECRET_SEPARATION"]);
  });

  it("rejects weak secrets and out-of-range capacity settings", () => {
    expect(operationalLaunchReadiness({
      ...operational,
      RUNNER_HMAC_SECRET: "a",
      BETA_DAILY_RUN_LIMIT: "21",
      BETA_DAILY_ANALYSIS_LIMIT: "501",
      BETA_EVIDENCE_STORAGE_LIMIT_BYTES: "900000001",
    }).missing).toEqual([
      "RUNNER_HMAC_SECRET",
      "BETA_DAILY_RUN_LIMIT",
      "BETA_DAILY_ANALYSIS_LIMIT",
      "BETA_EVIDENCE_STORAGE_LIMIT_BYTES",
    ]);
  });

  it("requires recorded operational confirmations", () => {
    expect(operationalLaunchReadiness({ ...operational, RESTORE_DRILL_CONFIRMED: "false" }).missing)
      .toEqual(["RESTORE_DRILL_CONFIRMED"]);
  });

  it("passes a complete production configuration", () => {
    expect(operationalLaunchReadiness(operational)).toEqual({ ok: true, missing: [] });
  });

  it("requires authenticated public HTTPS notification delivery", () => {
    expect(operationalLaunchReadiness({
      ...operational,
      NOTIFICATION_WEBHOOK_URL: "http://127.0.0.1:8787/hook",
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: "Example Notifications",
    }).missing).toEqual(["NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_SECRET"]);
    expect(operationalLaunchReadiness({
      ...operational,
      NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/greenlit",
      NOTIFICATION_WEBHOOK_SECRET: "n0tify-Q7mV4xP9kL2sD8wN5jH3cBt6aRz",
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: "Example Notifications",
    })).toEqual({ ok: true, missing: [] });
  });

  it("requires a complete pinned Stripe configuration when Stripe is enabled", () => {
    expect(operationalLaunchReadiness({
      ...operational,
      STRIPE_SECRET_KEY: "sk_test_example",
    }).missing).toEqual([
      "STRIPE_APP_CLIENT_ID",
      "STRIPE_APP_INSTALL_URL",
      "STRIPE_TOKEN_ENCRYPTION_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_API_VERSION",
    ]);
    expect(operationalLaunchReadiness({
      ...operational,
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_APP_CLIENT_ID: "ca_example",
      STRIPE_APP_INSTALL_URL: "https://marketplace.stripe.com/oauth/v2/authorize",
      STRIPE_TOKEN_ENCRYPTION_KEY: "12345678901234567890123456789012",
      STRIPE_WEBHOOK_SECRET: "whsec_12345678901234567890",
      STRIPE_API_VERSION: "2026-02-25.clover",
    })).toEqual({ ok: true, missing: [] });
  });
});
