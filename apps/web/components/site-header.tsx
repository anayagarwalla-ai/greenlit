import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";

export function SiteHeader({ dark = false }: { dark?: boolean }) {
  return (
    <header className={`site-header ${dark ? "site-header--dark" : ""}`}>
      <Brand inverse={dark} />
      <nav aria-label="Primary navigation">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/#build-timeline">Build timeline</Link>
        <Link href={"/trust" as Route}>What runs live</Link>
        <Link className="button button--small button--ink" href="/workspace?demo=guided">
          Judge walkthrough <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </nav>
    </header>
  );
}
