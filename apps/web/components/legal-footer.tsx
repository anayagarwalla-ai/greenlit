import Link from "next/link";
import type { Route } from "next";

export function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="Legal and privacy">
      <span>Greenlit · Blueprint Hackathon · July 19 to 28, 2026</span>
      <nav>
        <Link href={"/resources" as Route}>Resources</Link>
        <Link href={"/resources/roi-calculator" as Route}>Calculator</Link>
        <Link href={"/resources/changelog" as Route}>Changelog</Link>
        <Link href={"/trust" as Route}>Trust</Link>
        <Link href="/workspace?demo=guided">Judge walkthrough</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/records">Recordkeeping</Link>
        <Link href="/privacy-request">Privacy request</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </footer>
  );
}
