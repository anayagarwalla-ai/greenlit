import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  extractSourceFileText,
  MAX_EXTRACTED_SOURCE_CHARACTERS,
  MAX_PDF_PAGES,
  preflightPdfBytes,
  SourceInputError,
} from "./source-extraction";

function pdf(source: string) {
  return new TextEncoder().encode(`%PDF-1.7\n${source}\n%%EOF`);
}

describe("source extraction safety", () => {
  it("rejects PDFs that declare too many pages before invoking the parser", () => {
    expect(() => preflightPdfBytes(pdf(`1 0 obj\n<< /Type /Pages /Count ${MAX_PDF_PAGES + 1} >>\nendobj`)))
      .toThrowError(expect.objectContaining<Partial<SourceInputError>>({ code: "PDF_TOO_MANY_PAGES", status: 413 }));
  });

  it("accounts for compressed stream expansion", () => {
    const inflated = Buffer.alloc(64_000, 65);
    const compressed = deflateSync(inflated);
    const prefix = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, "latin1");
    const suffix = Buffer.from("\nendstream\nendobj\n%%EOF", "latin1");
    const bytes = Buffer.concat([prefix, compressed, suffix]);
    expect(preflightPdfBytes(bytes).decodedTotal).toBe(inflated.byteLength);
  });

  it("rejects oversized text after normalization", async () => {
    const file = new File(["x".repeat(MAX_EXTRACTED_SOURCE_CHARACTERS + 1)], "scope.txt", { type: "text/plain" });
    await expect(extractSourceFileText(file)).rejects.toMatchObject({ code: "SOURCE_TEXT_TOO_LONG", status: 413 });
  });
});
