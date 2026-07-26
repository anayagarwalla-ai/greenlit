import Link from "next/link";
import { ArrowRight, Check, Clock3, Users } from "lucide-react";
import { DemoRequestForm } from "@/components/demo-request-form";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata = publicPageMetadata({
  title: "Request a Greenlit demo",
  description: "Request a synthetic Greenlit walkthrough or discuss the invitation-only design-partner beta for U.S. web agencies.",
  path: "/request-demo",
});

export default function RequestDemoPage() {
  return (
    <main className="resource-shell request-demo-page">
      <ResourceHeader />
      <section className="request-demo-hero">
        <div>
          <span className="resource-kicker">For U.S. web agencies</span>
          <h1>See whether one milestone can move with <em>less chasing.</em></h1>
          <p>Greenlit is looking for a small number of design partners with a real approval bottleneck, a suitable public staging workflow, and one accountable client reviewer.</p>
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
