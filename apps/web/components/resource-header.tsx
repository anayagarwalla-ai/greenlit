import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";

export function ResourceHeader({ back = false }: { back?: boolean }) {
  return (
    <header className="resource-header">
      <Brand />
      <nav aria-label="Resource navigation">
        {back && <Link href={"/resources" as Route}><ArrowLeft size={15} /> All resources</Link>}
        <Link href={"/resources/roi-calculator" as Route}>Calculator</Link>
        <Link href={"/resources/changelog" as Route}>Changelog</Link>
        <Link href={"/trust" as Route}>Trust</Link>
        <Link className="button button--small button--ink" href={"/request-demo" as Route}>
          Request demo <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </nav>
    </header>
  );
}
