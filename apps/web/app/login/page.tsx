import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth-panel";
import { getOptionalUser } from "@/lib/supabase-server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { safeAuthNext } from "@/lib/auth-next";

export const metadata: Metadata = { title: "Agency sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const requested = params.next;
  const nextPath = safeAuthNext(requested);
  const user = await getOptionalUser();
  if (user && await betaAccessAllowedFresh(user)) redirect(nextPath as Route);
  const initialError = params.error === "expired"
    ? "This sign-in link is expired, invalid, or has already been used. Request a new link below."
    : params.error === "configuration"
      ? "Agency sign-in is not configured. Contact the beta operator."
      : params.error === "stripe-session-expired"
        ? "Your sign-in expired before Stripe returned. Request a new sign-in link; after you sign in, the dashboard will explain the unchanged Stripe connection."
      : params.error === "not-invited"
        ? "This email is not on the closed-beta invite list. Ask the beta operator for access."
      : params.error
        ? "The sign-in link could not be completed. Request a new link below."
        : "";
  return <AuthPanel nextPath={nextPath} initialError={initialError} />;
}
