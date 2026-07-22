import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireSupabaseAdmin } from "./database";
import { decryptStripeSecret, encryptStripeSecret } from "./stripe-crypto";

const STRIPE_API = "https://api.stripe.com/v1";

type StripeTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  stripe_user_id?: string;
  account_id?: string;
  livemode: boolean;
};

export type StripeCustomer = { id: string; name?: string | null; email?: string | null };
export type StripeInvoice = {
  id: string;
  customer: string;
  number?: string | null;
  status: "draft" | "open" | "paid" | "void" | "uncollectible" | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  due_date?: number | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  created: number;
};

function secretKey(): string {
  const value = process.env.STRIPE_SECRET_KEY;
  if (!value) throw new Error("Stripe is not configured.");
  return value;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_APP_CLIENT_ID && process.env.STRIPE_APP_INSTALL_URL && process.env.STRIPE_TOKEN_ENCRYPTION_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function stripeInstallUrl(origin: string, state: string): string {
  const configured = process.env.STRIPE_APP_INSTALL_URL;
  if (!configured) throw new Error("The Stripe install link is not configured.");
  const url = new URL(configured);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", `${origin}/api/stripe/callback`);
  return url.toString();
}

async function tokenRequest(form: URLSearchParams): Promise<StripeTokenResponse> {
  const response = await fetch(`${STRIPE_API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as Partial<StripeTokenResponse> & { error_description?: string; error?: string };
  if (!response.ok || !body.access_token || !body.refresh_token || !body.expires_in) throw new Error(body.error_description ?? body.error ?? "Stripe authorization failed.");
  return body as StripeTokenResponse;
}

export function exchangeStripeCode(code: string): Promise<StripeTokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code }));
}

export async function deauthorizeStripeAccount(accountId: string): Promise<void> {
  const form = new URLSearchParams({ client_id: process.env.STRIPE_APP_CLIENT_ID ?? "", stripe_user_id: accountId });
  const response = await fetch(`${STRIPE_API}/oauth/deauthorize`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({})) as { error_description?: string; error?: { message?: string } };
    throw new Error(body.error_description ?? body.error?.message ?? "Stripe could not be disconnected.");
  }
}

async function refreshStripeToken(refreshToken: string): Promise<StripeTokenResponse> {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export async function getStripeAccessForOwner(ownerUserId: string) {
  const database = requireSupabaseAdmin();
  const { data: connection, error } = await database.from("stripe_connections").select("*").eq("owner_user_id", ownerUserId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection || connection.status !== "CONNECTED" || !connection.access_token_ciphertext || !connection.refresh_token_ciphertext || !connection.access_token_expires_at) throw new Error("Connect Stripe before sending an invoice.");
  if (connection.livemode && process.env.STRIPE_ALLOW_LIVE_MODE !== "true") throw new Error("Live-mode Stripe access is disabled during the beta.");
  if (new Date(connection.access_token_expires_at).getTime() > Date.now() + 5 * 60_000) {
    return { accessToken: decryptStripeSecret(connection.access_token_ciphertext), accountId: connection.stripe_account_id as string, livemode: Boolean(connection.livemode) };
  }
  const claimId = randomUUID();
  const { data: claimed, error: claimError } = await database.rpc("claim_stripe_token_refresh_atomic", {
    p_owner_user_id: ownerUserId, p_expected_version: Number(connection.token_version), p_claim_id: claimId, p_claimed_at: new Date().toISOString(),
  }).maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) {
    const { data: current, error: currentError } = await database.from("stripe_connections").select("*").eq("owner_user_id", ownerUserId).maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (current?.status === "CONNECTED" && current.access_token_ciphertext && current.access_token_expires_at && new Date(current.access_token_expires_at).getTime() > Date.now() + 60_000) {
      return { accessToken: decryptStripeSecret(current.access_token_ciphertext), accountId: current.stripe_account_id as string, livemode: Boolean(current.livemode) };
    }
    throw new Error("Stripe credentials are already being refreshed. Retry in a moment.");
  }
  const claimedConnection = claimed as typeof connection;
  try {
    const refreshed = await refreshStripeToken(decryptStripeSecret(claimedConnection.refresh_token_ciphertext));
    if (refreshed.livemode && process.env.STRIPE_ALLOW_LIVE_MODE !== "true") throw new Error("Live-mode Stripe access is disabled during the beta.");
    const accountId = refreshed.stripe_user_id ?? refreshed.account_id ?? claimedConnection.stripe_account_id;
    const { data: updated, error: updateError } = await database.rpc("complete_stripe_token_refresh_atomic", {
      p_owner_user_id: ownerUserId, p_expected_version: Number(claimedConnection.token_version), p_claim_id: claimId,
      p_stripe_account_id: accountId, p_livemode: refreshed.livemode, p_access_ciphertext: encryptStripeSecret(refreshed.access_token),
      p_refresh_ciphertext: encryptStripeSecret(refreshed.refresh_token), p_access_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      p_completed_at: new Date().toISOString(),
    }).maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) throw new Error("Stripe credentials changed during refresh. Retry the request.");
    return { accessToken: refreshed.access_token, accountId, livemode: refreshed.livemode };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe token refresh failed.";
    const requireReauth = /invalid[_ -]?grant|revoked|reauthori[sz]|not connected/i.test(message);
    await database.rpc("release_stripe_token_refresh_atomic", { p_owner_user_id: ownerUserId, p_claim_id: claimId, p_error: message, p_require_reauth: requireReauth, p_released_at: new Date().toISOString() });
    throw error;
  }
}

async function stripeRequest<T>(accessToken: string, path: string, init?: { method?: "GET" | "POST"; form?: Record<string, string | number | boolean | null | undefined>; idempotencyKey?: string }): Promise<T> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(init?.form ?? {})) if (value !== null && value !== undefined) form.set(key, String(value));
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(init?.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      ...(process.env.STRIPE_API_VERSION ? { "Stripe-Version": process.env.STRIPE_API_VERSION } : {}),
    },
    ...(init?.method === "POST" ? { body: form } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Stripe returned HTTP ${response.status}.`);
  return body;
}

export async function listStripeCustomers(accessToken: string, email: string): Promise<StripeCustomer[]> {
  const result = await stripeRequest<{ data: StripeCustomer[] }>(accessToken, `/customers?email=${encodeURIComponent(email)}&limit=10`);
  return result.data.filter((customer) => customer.email?.toLowerCase() === email.toLowerCase());
}

export function retrieveStripeCustomer(accessToken: string, customerId: string) { return stripeRequest<StripeCustomer>(accessToken, `/customers/${encodeURIComponent(customerId)}`); }
export function createStripeCustomer(accessToken: string, input: { name: string; email: string; metadata: Record<string, string> }, idempotencyKey: string) {
  return stripeRequest<StripeCustomer>(accessToken, "/customers", { method: "POST", idempotencyKey, form: { name: input.name, email: input.email, ...Object.fromEntries(Object.entries(input.metadata).map(([key, value]) => [`metadata[${key}]`, value])) } });
}
export function createStripeInvoice(accessToken: string, input: { customer: string; daysUntilDue: number; description: string; metadata: Record<string, string> }, idempotencyKey: string) {
  return stripeRequest<StripeInvoice>(accessToken, "/invoices", { method: "POST", idempotencyKey, form: { customer: input.customer, collection_method: "send_invoice", days_until_due: input.daysUntilDue, auto_advance: false, description: input.description, ...Object.fromEntries(Object.entries(input.metadata).map(([key, value]) => [`metadata[${key}]`, value])) } });
}
export function createStripeInvoiceItem(accessToken: string, input: { customer: string; invoice: string; amount: number; currency: string; description: string; metadata: Record<string, string> }, idempotencyKey: string) {
  return stripeRequest<{ id: string }>(accessToken, "/invoiceitems", { method: "POST", idempotencyKey, form: { customer: input.customer, invoice: input.invoice, amount: input.amount, currency: input.currency.toLowerCase(), description: input.description, ...Object.fromEntries(Object.entries(input.metadata).map(([key, value]) => [`metadata[${key}]`, value])) } });
}
export function sendStripeInvoice(accessToken: string, invoiceId: string, idempotencyKey: string) { return stripeRequest<StripeInvoice>(accessToken, `/invoices/${encodeURIComponent(invoiceId)}/send`, { method: "POST", idempotencyKey }); }
export function retrieveStripeInvoice(accessToken: string, invoiceId: string) { return stripeRequest<StripeInvoice>(accessToken, `/invoices/${encodeURIComponent(invoiceId)}`); }

export function verifyStripeWebhook(rawBody: string, signatureHeader: string | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map((part) => part.split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return signatures.some((signature) => {
    const left = Buffer.from(signature ?? "", "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  });
}
