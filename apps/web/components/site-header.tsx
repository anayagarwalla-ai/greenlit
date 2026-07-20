import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";

export function SiteHeader({ dark = false }: { dark?: boolean }) {
  return (
    <header className={`site-header ${dark ? "site-header--dark" : ""}`}>
      <Brand inverse={dark} />
      <nav aria-label="Primary navigation">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/workspace">Demo workspace</Link>
        <Link className="button button--small button--ink" href="/workspace">
          Open live demo <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </nav>
    </header>
  );
}

