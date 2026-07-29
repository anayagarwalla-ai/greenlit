import assert from "node:assert/strict";
import test from "node:test";
import { productionReadinessMissing } from "./release-readiness.mjs";

const readyEnvironment = {
  NEXT_PUBLIC_APP_URL: "https://proof.example.com",
  NEXT_PUBLIC_OPERATOR_NAME: "Example Operator LLC",
  NEXT_PUBLIC_OPERATOR_ADDRESS: "123 Main Street, Example, CA 90000",
  NEXT_PUBLIC_GOVERNING_LAW: "the laws of California",
  NEXT_PUBLIC_VENUE: "the state and federal courts in Example County, California",
  NEXT_PUBLIC_SUPPORT_EMAIL: "support@example.com",
  NEXT_PUBLIC_SECURITY_EMAIL: "security@example.com",
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

test("release preflight uses the same current legal and operational keys as runtime readiness", () => {
  assert.deepEqual(productionReadinessMissing(readyEnvironment), []);
});

test("legacy confirmation aliases cannot accidentally pass the production gate", () => {
  const missing = productionReadinessMissing({
    ...readyEnvironment,
    CUSTOM_SMTP_CONFIRMED: undefined,
    BACKUP_SCHEDULE_CONFIRMED: undefined,
    RESTORE_DRILL_CONFIRMED: undefined,
    SMTP_DELIVERY_CONFIRMED: "true",
    BACKUP_COMPLETED: "true",
    RESTORE_VERIFIED: "true",
  });
  assert.deepEqual(missing, [
    "CUSTOM_SMTP_CONFIRMED",
    "BACKUP_SCHEDULE_CONFIRMED",
    "RESTORE_DRILL_CONFIRMED",
  ]);
});

test("a monitored security contact is mandatory and notification-provider disclosure is conditional", () => {
  assert.deepEqual(
    productionReadinessMissing({ ...readyEnvironment, NEXT_PUBLIC_SECURITY_EMAIL: "" }),
    ["NEXT_PUBLIC_SECURITY_EMAIL"],
  );
  assert.deepEqual(
    productionReadinessMissing({ ...readyEnvironment, NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/greenlit" }),
    ["NOTIFICATION_WEBHOOK_SECRET", "NEXT_PUBLIC_NOTIFICATION_PROVIDER"],
  );
  assert.deepEqual(
    productionReadinessMissing({
      ...readyEnvironment,
      NOTIFICATION_WEBHOOK_URL: "https://hooks.example.com/greenlit",
      NOTIFICATION_WEBHOOK_SECRET: "n0tify-Q7mV4xP9kL2sD8wN5jH3cBt6aRz",
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: "Example Notifications",
    }),
    [],
  );
});

test("production notification delivery rejects unsafe webhook targets", () => {
  assert.deepEqual(
    productionReadinessMissing({
      ...readyEnvironment,
      NOTIFICATION_WEBHOOK_URL: "http://127.0.0.1:8787/greenlit",
      NOTIFICATION_WEBHOOK_SECRET: "n0tify-Q7mV4xP9kL2sD8wN5jH3cBt6aRz",
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: "Example Notifications",
    }),
    ["NOTIFICATION_WEBHOOK_URL"],
  );
  assert.deepEqual(
    productionReadinessMissing({
      ...readyEnvironment,
      NOTIFICATION_WEBHOOK_URL: "https://user:password@hooks.example.com/greenlit",
      NOTIFICATION_WEBHOOK_SECRET: "n0tify-Q7mV4xP9kL2sD8wN5jH3cBt6aRz",
      NEXT_PUBLIC_NOTIFICATION_PROVIDER: "Example Notifications",
    }),
    ["NOTIFICATION_WEBHOOK_URL"],
  );
});

test("release preflight rejects weak secrets and invalid capacity settings", () => {
  assert.deepEqual(
    productionReadinessMissing({
      ...readyEnvironment,
      RUNNER_HMAC_SECRET: "a",
      BETA_DAILY_RUN_LIMIT: "21",
      BETA_DAILY_ANALYSIS_LIMIT: "501",
      BETA_EVIDENCE_STORAGE_LIMIT_BYTES: "900000001",
    }),
    [
      "RUNNER_HMAC_SECRET",
      "BETA_DAILY_RUN_LIMIT",
      "BETA_DAILY_ANALYSIS_LIMIT",
      "BETA_EVIDENCE_STORAGE_LIMIT_BYTES",
    ],
  );
});

test("release preflight requires a complete pinned Stripe configuration when enabled", () => {
  assert.deepEqual(
    productionReadinessMissing({
      ...readyEnvironment,
      STRIPE_SECRET_KEY: "sk_test_example",
    }),
    [
      "STRIPE_APP_CLIENT_ID",
      "STRIPE_APP_INSTALL_URL",
      "STRIPE_TOKEN_ENCRYPTION_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_API_VERSION",
    ],
  );
});
