import { describe, expect, it } from "vitest";
import { renderResourceDownload, resourceDownloadLabel } from "./resource-download";
import { resourceGuides } from "./resource-library";

describe("resource downloads", () => {
  it("keeps download names unique and renders every downloadable guide", () => {
    const downloadable = resourceGuides.filter((guide) => guide.downloadHref);
    const filenames = downloadable.map((guide) => guide.downloadHref);

    expect(new Set(filenames).size).toBe(filenames.length);
    for (const guide of downloadable) {
      const rendered = renderResourceDownload(guide);
      expect(rendered).toContain(`# ${guide.title}`);
      expect(rendered).toContain(guide.summary);
      expect(rendered).not.toContain("—");
    }
  });

  it("labels plain-text and Markdown downloads accurately", () => {
    expect(resourceDownloadLabel("/resources/downloads/approval-email-templates.txt"))
      .toBe("Download a text copy");
    expect(resourceDownloadLabel("/resources/downloads/agency-quickstart.md"))
      .toBe("Download a Markdown copy");
  });
});
