import { normalizeSourceText } from "./analysis";

export const MAX_SOURCE_FILE_BYTES = 1_500_000;

export class SourceInputError extends Error {
  constructor(message: string, readonly code: string, readonly status = 422) { super(message); }
}

function isSupportedTextFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
}

export async function extractSourceFileText(file: File) {
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new SourceInputError("Keep uploads under 1.5 MB so the complete draft can survive sign-in safely.", "FILE_TOO_LARGE", 413);
  if (file.size === 0) throw new SourceInputError("The selected file is empty.", "EMPTY_FILE");
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  if (isPdf) {
    if (!("DOMMatrix" in globalThis)) await import("pdf-parse/worker");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const result = await parser.getText();
      const text = normalizeSourceText(result.text);
      if (!text) throw new SourceInputError("No selectable text was found in this PDF. Paste the SOW text instead.", "EMPTY_PDF");
      return text;
    } finally { await parser.destroy(); }
  }
  if (!isSupportedTextFile(file)) throw new SourceInputError("Upload a PDF, TXT, or Markdown SOW.", "UNSUPPORTED_FILE", 415);
  return normalizeSourceText(await file.text());
}
