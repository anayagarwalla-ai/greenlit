import type { Route } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ResourceHeader } from "@/components/resource-header";
import { RoiCalculator } from "@/components/roi-calculator";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Approval-delay calculator",
  description: "Estimate the team capacity and milestone time currently tied up in preparing and chasing client approvals.",
  path: "/resources/roi-calculator",
});

export default function RoiCalculatorPage() {
  return (
    <main className="resource-shell">
      <ResourceHeader back />
      <article className="guide guide--calculator">
        <header className="guide-hero">
          <span className="resource-kicker">Grow the beta</span>
          <h1>Approval-delay calculator</h1>
          <p>Estimate the operational cost of preparing and chasing milestone decisions, then replace the assumptions with observed beta data.</p>
          <div className="guide-meta"><span>Agency operators</span><span>Interactive planning model</span><span>No data is submitted</span></div>
        </header>
        <RoiCalculator />
        <section className="calculator-method">
          <div>
            <span className="resource-section__eyebrow">Calculation</span>
            <h2>What the model does</h2>
            <p>Monthly time recovered equals milestones per month multiplied by approval-work hours per milestone and the modeled improvement percentage. Capacity value multiplies those hours by the blended team value. Milestone-days apply the same improvement rate to the current approval delay.</p>
          </div>
          <div>
            <span className="resource-section__eyebrow">Use responsibly</span>
            <h2>What the model does not prove</h2>
            <p>It does not predict revenue, cash collection, profitability, or a Greenlit result. Use it to choose what to measure, then publish only comparisons supported by consistent timestamps and customer-approved evidence.</p>
          </div>
        </section>
        <footer className="guide-next"><Link href={"/resources" as Route}><ArrowLeft size={16} /> All resources</Link></footer>
      </article>
    </main>
  );
}
