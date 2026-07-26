import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { LegalFooter } from "@/components/legal-footer";
import { FeedbackWidget } from "@/components/feedback-widget";
import { SkipLink } from "@/components/skip-link";

export const metadata: Metadata = {
  title: { default: "Greenlit — Turn your SOW into proof", template: "%s · Greenlit" },
  description: "Acceptance-to-invoice evidence for web agencies. Turn acceptance criteria into verified proof, client approval, and an invoice-ready record.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Greenlit — Turn your SOW into proof",
    description: "Give the client proof, not a test report.",
    type: "website",
    url: "/",
    images: [{ url: "/brand/greenlit-social-card.png", width: 1200, height: 630, alt: "Greenlit" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Greenlit — Turn your SOW into proof",
    description: "Give the client proof, not a test report.",
    images: ["/brand/greenlit-social-card.png"],
  },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "64x64" }],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A strict nonce-based CSP requires request-time rendering so Next can apply
  // the fresh nonce to its framework and hydration scripts.
  await connection();
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body><SkipLink /><div id="main-content" tabIndex={-1}>{children}</div><LegalFooter /><FeedbackWidget /></body>
    </html>
  );
}
