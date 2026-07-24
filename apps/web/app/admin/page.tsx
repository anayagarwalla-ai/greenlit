import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperatorConsole } from "@/components/operator-console";
import { AdminMfaGate } from "@/components/admin-mfa-gate";
import { getAdminAuthorization } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Beta operations", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const auth = await getAdminAuthorization();
  if (!auth.user) notFound();
  if (!auth.aal2) return <AdminMfaGate />;
  return <OperatorConsole />;
}
