import type { User } from "@supabase/supabase-js";

function configuredEmails(name: "BETA_ALLOWED_EMAILS" | "ADMIN_EMAILS") {
  return new Set((process.env[name] ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function betaAccessAllowed(user: Pick<User, "email">) {
  const allowed = configuredEmails("BETA_ALLOWED_EMAILS");
  if (allowed.size === 0) return process.env.NODE_ENV !== "production";
  return Boolean(user.email && allowed.has(user.email.toLowerCase()));
}

export function adminAccessAllowed(user: Pick<User, "email">) {
  const allowed = configuredEmails("ADMIN_EMAILS");
  return Boolean(user.email && allowed.has(user.email.toLowerCase()));
}
