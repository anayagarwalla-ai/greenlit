import Link from "next/link";
import { ArrowRight, Check, Clock3, Users } from "lucide-react";
import { DemoRequestForm } from "@/components/demo-request-form";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Product research request",
  description: "Optionally share an agency approval workflow for Greenlit product research. The public walkthrough remains available without this form.",
  path: "/request-demo",
});

export default function RequestDemoPage() {
  return (
    <main className="resource-shell request-demo-page">
      <ResourceHeader />
      <section className="request-demo-hero">
        <div>
          <span className="resource-kicker">Optional product research</span>
          <h1>Share where milestone approval gets <em>stuck.</em></h1>
          <p>The walkthrough is available without this form. Use this request only if you want to share an agency workflow for future product research.</p>
          <ul>
            <li><Clock3 size={17} /><span><strong>Twenty focused minutes</strong>Discovery first, then a six-to-eight-minute synthetic product walkthrough.</span></li>
            <li><Users size={17} /><span><strong>Built for agency delivery teams</strong>Owners, operations leads, project managers, and account leads are the best fit.</span></li>
            <li><Check size={17} /><span><strong>No confidential SOW required</strong>The first conversation and demo use synthetic information only.</span></li>
          </ul>
          <Link className="text-link" href="/resources/agency-quickstart">Review the agency quick-start <ArrowRight size={15} /></Link>
        </div>
        <DemoRequestForm />
      </section>
    </main>
  );
}
