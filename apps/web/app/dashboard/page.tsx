import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AgencyDashboard } from "@/components/agency-dashboard";
import { getOptionalUser } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Agency dashboard", robots: { index: false, follow: false } };

export default async function DashboardPage() {
  if (!await getOptionalUser()) redirect("/login" as Route);
  return <AgencyDashboard />;
}
