import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperatorConsole } from "@/components/operator-console";
import { getOptionalUser } from "@/lib/supabase-server";
import { adminAccessAllowed } from "@/lib/beta-access";

export const metadata: Metadata = { title: "Beta operations", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const user = await getOptionalUser();
  if (!user || !adminAccessAllowed(user)) notFound();
  return <OperatorConsole />;
}
