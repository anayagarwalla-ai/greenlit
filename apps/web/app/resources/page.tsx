import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, Calculator, FileText, Library, ShieldCheck, Sparkles } from "lucide-react";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";
import { publicResourceCategories, publicResourceGuides } from "@/lib/resource-library";

export const metadata = publicPageMetadata({
  title: "Resources for web agencies",
  description: "Greenlit guides, templates, and playbooks for evidence-backed milestone review, client approval, and invoicing.",
  path: "/resources",
});

const categoryDescriptions: Record<(typeof publicResourceCategories)[number], string> = {
  "Start here": "Understand the workflow and complete a first proof flow.",
  "Run a milestone": "Write stronger criteria, verify the build, and resolve common problems.",
  "Work with clients": "Introduce the review clearly and make the decision easy.",
};

export default function ResourcesPage() {
  return (
    <main className="resource-shell">
      <ResourceHeader />
      <section className="resource-hero">
        <div>
          <span className="resource-kicker"><Library size={15} /> Greenlit field guide</span>
          <h1>Get the milestone<br /><em>over the line.</em></h1>
          <p>Practical guides and copy-ready templates for turning agreed scope into proof, a client decision, and a clean billing handoff.</p>
          <div className="resource-hero__actions">
            <Link className="button button--lime" href={"/resources/agency-quickstart" as Route}>Start with the quick-start <ArrowRight size={17} /></Link>
            <Link className="text-link" href={"/workspace?demo=guided" as Route}>Explore the synthetic demo</Link>
          </div>
        </div>
        <aside className="resource-kit-card">
          <span>Workflow starter kit</span>
          <strong>One real milestone.<br />One named reviewer.<br />One clear decision.</strong>
          <ul>
            <li><BookOpenCheck size={16} /> Agency and client onboarding</li>
            <li><FileText size={16} /> Milestone and email templates</li>
            <li><ShieldCheck size={16} /> Trust and operating boundaries</li>
            <li><Calculator size={16} /> Approval-delay estimator</li>
          </ul>
        </aside>
      </section>

      <section className="resource-index" aria-labelledby="library-title">
        <div className="resource-index__head">
          <div><span className="resource-kicker">The library</span><h2 id="library-title">Use the piece you need now.</h2></div>
          <p>Every resource reflects the current product build. It does not assume unbuilt integrations, legal certifications, or customer results.</p>
        </div>
        {publicResourceCategories.map((category) => {
          const guides = publicResourceGuides.filter((guide) => guide.category === category);
          return (
            <section className="resource-category" key={category} aria-labelledby={`category-${category.replaceAll(" ", "-").toLowerCase()}`}>
              <div className="resource-category__intro">
                <h3 id={`category-${category.replaceAll(" ", "-").toLowerCase()}`}>{category}</h3>
                <p>{categoryDescriptions[category]}</p>
              </div>
              <div className="resource-card-grid">
                {guides.map((guide) => (
                  <Link className="resource-card" href={`/resources/${guide.slug}` as Route} key={guide.slug}>
                    <div><span>{guide.audience}</span><span>{guide.readTime}</span></div>
                    <h4>{guide.title}</h4>
                    <p>{guide.summary}</p>
                    <strong>Open guide <ArrowRight size={15} /></strong>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        <section className="resource-category" aria-labelledby="category-tools-and-updates">
          <div className="resource-category__intro">
            <h3 id="category-tools-and-updates">Tools and updates</h3>
            <p>Model the cost of approval delay and see what changed in the current build.</p>
          </div>
          <div className="resource-card-grid">
            <Link className="resource-card" href={"/resources/roi-calculator" as Route}>
              <div><span>Agency operators</span><span>Interactive</span></div>
              <h4>Approval-delay calculator</h4>
              <p>Estimate the team capacity and milestone time currently tied up in preparing and chasing approvals.</p>
              <strong>Open calculator <ArrowRight size={15} /></strong>
            </Link>
            <Link className="resource-card" href={"/resources/changelog" as Route}>
              <div><span>Product evaluation</span><span>Public timeline</span></div>
              <h4>Product build log</h4>
              <p>Review meaningful changes to agency setup, client review, evidence, and billing handoff.</p>
              <strong>Read changelog <ArrowRight size={15} /></strong>
            </Link>
          </div>
        </section>
      </section>

      <section className="resource-boundary">
        <Sparkles size={25} />
        <div>
          <span>Ready to see the complete story?</span>
          <h2>Follow one SOW promise all the way to approval.</h2>
          <p>The public walkthrough needs no account and uses synthetic data. It includes the false-success failure, corrected pass, client decision, and approval record.</p>
        </div>
        <Link className="button button--outline" href="/workspace?demo=guided">Start the walkthrough</Link>
      </section>
    </main>
  );
}
