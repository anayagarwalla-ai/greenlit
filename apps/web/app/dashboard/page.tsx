import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AgencyDashboard } from "@/components/agency-dashboard";
import { getOptionalUser } from "@/lib/supabase-server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { STRIPE_RETURN_STATES } from "@/lib/stripe-return";

export const metadata: Metadata = { title: "Agency dashboard", robots: { index: false, follow: false } };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ stripe?: string | string[] }> }) {
  const params = await searchParams;
  const stripeState = typeof params.stripe === "string"
    && (STRIPE_RETURN_STATES as readonly string[]).includes(params.stripe)
    ? params.stripe
    : "";
  const nextPath = stripeState ? `/dashboard?stripe=${encodeURIComponent(stripeState)}` : "/dashboard";
  const user = await getOptionalUser();
  if (!user) {
    const error = stripeState === "session-expired" ? "stripe-session-expired" : "";
    redirect(`/login?next=${encodeURIComponent(nextPath)}${error ? `&error=${error}` : ""}` as Route);
  }
  if (!await betaAccessAllowedFresh(user)) redirect("/login?error=not-invited" as Route);
  return <AgencyDashboard />;
}
