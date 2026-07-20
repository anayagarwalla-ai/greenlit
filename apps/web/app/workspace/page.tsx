import type { Metadata } from "next";
import { MilestoneStudio } from "@/components/milestone-studio";

export const metadata: Metadata = {
  title: "Spring launch workspace",
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return <MilestoneStudio />;
}

