import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./database";

function configuredEmails(name: "BETA_ALLOWED_EMAILS" | "ADMIN_EMAILS") {
  return new Set((process.env[name] ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function betaAccessAllowed(user: Pick<User, "email">) {
  return betaEmailAllowed(user.email);
}

export async function betaAccessAllowedFresh(user: Pick<User, "email"> | string | null | undefined) {
  const email = typeof user === "string" ? user : user?.email;
  if (!email) return false;
  const configured = betaEmailAllowed(email);
  const database = getSupabaseAdmin();
  if (!database) return configured;
  const { data, error } = await database.from("beta_invites").select("status").eq("email", email.trim().toLowerCase()).maybeSingle();
  if (error) return false;
  if (data?.status === "REMOVED") return false;
  return data?.status === "ACTIVE" || configured;
}

export function betaEmailAllowed(email: string | null | undefined) {
  const allowed = configuredEmails("BETA_ALLOWED_EMAILS");
  if (allowed.size === 0) return process.env.NODE_ENV !== "production";
  return Boolean(email && allowed.has(email.trim().toLowerCase()));
}

export function adminAccessAllowed(user: Pick<User, "email">) {
  const allowed = configuredEmails("ADMIN_EMAILS");
  return Boolean(user.email && allowed.has(user.email.toLowerCase()));
}
