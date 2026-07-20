import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth-panel";
import { getOptionalUser } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Agency sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const requested = (await searchParams).next;
  const nextPath = requested === "/workspace" ? "/workspace" : "/dashboard";
  if (await getOptionalUser()) redirect(nextPath as Route);
  return <AuthPanel nextPath={nextPath} />;
}
