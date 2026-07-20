import { notFound } from "next/navigation";
import { FixtureSite } from "@/components/fixture-site";

export const metadata = { title: "Acme Outdoors staging fixture", robots: { index: false, follow: false } };

export default async function FixturePage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  if (version !== "rc1" && version !== "rc2") notFound();
  return <FixtureSite version={version} />;
}

