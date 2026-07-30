import type { Metadata } from "next";
import { MilestoneStudio } from "@/components/milestone-studio";
import { geminiServiceConfiguration } from "@/lib/gemini-service";

export const metadata: Metadata = {
  title: "Milestone workspace",
  robots: { index: false, follow: false },
};

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const params = await searchParams;
  const guidedDemo = params.demo === "guided";
  return (
    <MilestoneStudio
      geminiConfigured={Boolean(process.env.GEMINI_API_KEY)}
      geminiPaidService={geminiServiceConfiguration().paidService}
      guidedDemo={guidedDemo}
    />
  );
}
