import type { ResourceGuide } from "@/lib/resource-library";

function escapeTableCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

export function resourceDownloadLabel(downloadHref: string) {
  return downloadHref.toLowerCase().endsWith(".txt")
    ? "Download a text copy"
    : "Download a Markdown copy";
}

export function renderResourceDownload(guide: ResourceGuide) {
  const lines = [
    `# ${guide.title}`,
    "",
    guide.summary,
    "",
    `Audience: ${guide.audience}`,
    `Reading time: ${guide.readTime}`,
  ];

  for (const section of guide.sections) {
    lines.push("", `## ${section.title}`, "");

    for (const paragraph of section.paragraphs ?? []) {
      lines.push(paragraph, "");
    }

    section.steps?.forEach((step, index) => {
      lines.push(`${index + 1}. **${step.title}:** ${step.detail}`);
    });

    for (const bullet of section.bullets ?? []) {
      lines.push(`- ${bullet}`);
    }

    if (section.table) {
      const { columns, rows } = section.table;
      lines.push(
        "",
        `| ${columns.map(escapeTableCell).join(" | ")} |`,
        `| ${columns.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
      );
    }

    for (const template of section.templates ?? []) {
      lines.push("", `### ${template.label}`, "", template.content);
    }

    if (section.callout) {
      lines.push("", `> **${section.callout.title}**`, `> ${section.callout.body}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
