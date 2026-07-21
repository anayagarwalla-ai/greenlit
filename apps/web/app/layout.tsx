import type { Metadata } from "next";
import "./globals.css";
import { LegalFooter } from "@/components/legal-footer";
import { FeedbackWidget } from "@/components/feedback-widget";

export const metadata: Metadata = {
  title: { default: "MilestoneProof — Turn your SOW into proof", template: "%s · MilestoneProof" },
  description: "Acceptance-to-invoice evidence for web agencies. Turn acceptance criteria into verified proof, client approval, and an invoice-ready record.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "MilestoneProof — Turn your SOW into proof",
    description: "Give the client proof, not a test report.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body><a className="skip-link" href="#main-content">Skip to main content</a><div id="main-content" tabIndex={-1}>{children}</div><LegalFooter /><FeedbackWidget /></body>
    </html>
  );
}
