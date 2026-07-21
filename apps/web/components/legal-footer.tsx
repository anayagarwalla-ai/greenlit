import Link from "next/link";

export function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="Legal and privacy">
      <span>MilestoneProof · U.S. business beta · 18+</span>
      <nav>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/records">Recordkeeping</Link>
        <Link href="/privacy-request">Privacy request</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </footer>
  );
}
