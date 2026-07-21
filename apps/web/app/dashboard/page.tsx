import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AgencyDashboard } from "@/components/agency-dashboard";
import { getOptionalUser } from "@/lib/supabase-server";
import { betaAccessAllowed } from "@/lib/beta-access";

export const metadata: Metadata = { title: "Agency dashboard", robots: { index: false, follow: false } };

export default async function DashboardPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/login" as Route);
  if (!betaAccessAllowed(user)) redirect("/login?error=not-invited" as Route);
  return <AgencyDashboard />;
}
