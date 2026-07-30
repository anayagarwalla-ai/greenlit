"use client";

import { usePathname } from "next/navigation";
import { FeedbackWidget } from "@/components/feedback-widget";
import { LegalFooter } from "@/components/legal-footer";

export function GlobalProductChrome() {
  const pathname = usePathname();
  const fixturePath = pathname === "/fixture" || pathname.startsWith("/fixture/");

  // The Acme routes are deliberately isolated staging targets. Greenlit's
  // global controls would change the page under test and could be mistaken
  // for elements belonging to the fixture itself.
  if (fixturePath) return null;

  return (
    <>
      <LegalFooter />
      <FeedbackWidget />
    </>
  );
}
