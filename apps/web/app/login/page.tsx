import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth-panel";
import { getOptionalUser } from "@/lib/supabase-server";
import { betaAccessAllowed } from "@/lib/beta-access";
import { safeAuthNext } from "@/lib/auth-next";

export const metadata: Metadata = { title: "Agency sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const requested = params.next;
  const nextPath = safeAuthNext(requested);
  const user = await getOptionalUser();
  if (user && betaAccessAllowed(user)) redirect(nextPath as Route);
  const initialError = params.error === "expired"
    ? "This sign-in link is expired, invalid, or has already been used. Request a new link below."
    : params.error === "configuration"
      ? "Agency sign-in is not configured. Contact the beta operator."
      : params.error === "not-invited"
        ? "This email is not on the closed-beta invite list. Ask the beta operator for access."
      : params.error
        ? "The sign-in link could not be completed. Request a new link below."
        : "";
  return <AuthPanel nextPath={nextPath} initialError={initialError} />;
}
