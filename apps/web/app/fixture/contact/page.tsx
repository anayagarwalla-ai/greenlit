import type { Metadata } from "next";
import { FixtureSite } from "@/components/fixture-site";

export const metadata: Metadata = { title: "Acme Outdoors fixture — contact destination", robots: { index: false, follow: false } };

// The isolated staging fixture's "Plan my trip" CTA lands here. This is part
// of the synthetic Acme Outdoors fixture used by guided-demo and imported-
// fixture verification runs — it is not Greenlit's own contact page.
export default function FixtureContactDestinationPage() {
  return <FixtureSite version="rc2" />;
}
