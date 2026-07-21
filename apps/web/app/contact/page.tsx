import type { Metadata } from "next";
import { FixtureSite } from "@/components/fixture-site";

export const metadata: Metadata = { title: "Acme contact fixture", robots: { index: false, follow: false } };

export default function ContactFixturePage() {
  return <FixtureSite version="rc2" />;
}
