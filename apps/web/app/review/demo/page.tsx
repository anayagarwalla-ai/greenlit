import type { Metadata } from "next";
import { ClientReview } from "@/components/client-review";

export const metadata: Metadata = {
  title: "Review Spring launch",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ReviewPage() {
  return <ClientReview />;
}

