import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { ResourceCopyBlock } from "@/components/resource-copy-block";
import { ResourceHeader } from "@/components/resource-header";
import { publicPageMetadata } from "@/lib/page-metadata";
import { resourceDownloadLabel } from "@/lib/resource-download";
import { getPublicResourceGuide, publicResourceGuides } from "@/lib/resource-library";

export function generateStaticParams() {
  return publicResourceGuides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getPublicResourceGuide(slug);
  if (!guide) return {};
  return publicPageMetadata({
    title: guide.title,
    description: guide.summary,
    path: `/resources/${guide.slug}`,
  });
}

export default async function ResourceGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getPublicResourceGuide(slug);
  if (!guide) notFound();

  const currentIndex = publicResourceGuides.findIndex((candidate) => candidate.slug === guide.slug);
  const nextGuide = publicResourceGuides[(currentIndex + 1) % publicResourceGuides.length] ?? guide;

  return (
    <main className="resource-shell">
      <ResourceHeader back />
      <article className="guide">
        <header className="guide-hero">
          <span className="resource-kicker">{guide.category}</span>
          <h1>{guide.title}</h1>
          <p>{guide.summary}</p>
          <div className="guide-meta"><span>{guide.audience}</span><span>{guide.readTime} read</span><span>Updated {guide.updatedAt ?? "July 24, 2026"}</span></div>
          {guide.downloadHref && <a className="button button--outline" href={guide.downloadHref} download><Download size={16} /> {resourceDownloadLabel(guide.downloadHref)}</a>}
        </header>

        <div className="guide-layout">
          <aside className="guide-toc" aria-label="On this page">
            <strong>On this page</strong>
            {guide.sections.map((section, index) => <a href={`#section-${index + 1}`} key={`${section.title}-${index}`}>{index + 1}. {section.title}</a>)}
          </aside>
          <div className="guide-content">
            {guide.sections.map((section, index) => (
              <section className="resource-section" id={`section-${index + 1}`} key={`${section.title}-${index}`}>
                {section.eyebrow && <span className="resource-section__eyebrow">{section.eyebrow}</span>}
                <h2>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.steps && <ol className="resource-steps">{section.steps.map((step) => <li key={step.title}><span>{String(section.steps!.indexOf(step) + 1).padStart(2, "0")}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol>}
                {section.bullets && <ul className="resource-bullets">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
                {section.table && <div className="resource-table-wrap" role="region" aria-label={`${section.title} table`} tabIndex={0}><table className="resource-table"><thead><tr>{section.table.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
                {section.templates?.map((template) => <ResourceCopyBlock key={template.label} label={template.label} content={template.content} />)}
                {section.callout && <aside className={`resource-callout resource-callout--${section.callout.tone ?? "neutral"}`}><strong>{section.callout.title}</strong><p>{section.callout.body}</p></aside>}
              </section>
            ))}
          </div>
        </div>

        <footer className="guide-next">
          <Link href={"/resources" as Route}><ArrowLeft size={16} /> All resources</Link>
          <Link href={`/resources/${nextGuide.slug}` as Route}><span>Read next</span><strong>{nextGuide.title} <ArrowRight size={16} /></strong></Link>
        </footer>
      </article>
    </main>
  );
}
