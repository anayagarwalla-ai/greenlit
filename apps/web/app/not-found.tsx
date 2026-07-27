import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-card">
        <Brand />
        <span className="resource-kicker">404 · Page not found</span>
        <h1>This path is not part of the proof.</h1>
        <p>The link may be incomplete or the page may have moved. Return to Greenlit, explore the public resources, or request a company walkthrough.</p>
        <div className="not-found-actions">
          <Link className="button button--lime" href={"/" as Route}>Return home <ArrowRight size={16} /></Link>
          <Link className="button button--outline" href={"/resources" as Route}><BookOpen size={16} /> View resources</Link>
          <Link href={"/request-demo" as Route}>Request a demo</Link>
        </div>
      </section>
    </main>
  );
}
