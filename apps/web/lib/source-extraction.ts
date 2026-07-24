import { normalizeSourceText } from "./analysis";
import { inflateSync } from "node:zlib";

export const MAX_SOURCE_FILE_BYTES = 1_500_000;
export const MAX_PDF_PAGES = 50;
export const MAX_PDF_OBJECTS = 2_500;
export const MAX_PDF_STREAMS = 800;
export const MAX_PDF_DECOMPRESSED_BYTES = 12_000_000;
export const MAX_EXTRACTED_SOURCE_CHARACTERS = 45_000;

export class SourceInputError extends Error {
  constructor(message: string, readonly code: string, readonly status = 422) { super(message); }
}

function isSupportedTextFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown");
}

export function preflightPdfBytes(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString("latin1");
  if (!source.startsWith("%PDF-")) throw new SourceInputError("This file does not have a valid PDF header.", "INVALID_PDF");
  const objectCount = source.match(/\b\d+\s+\d+\s+obj\b/g)?.length ?? 0;
  const streamCount = source.match(/\bstream\r?\n/g)?.length ?? 0;
  const declaredSize = Math.max(0, ...[...source.matchAll(/\/Size\s+(\d+)/g)].map((match) => Number(match[1]) || 0));
  const declaredPages = Math.max(0, ...[...source.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]) || 0));
  if (objectCount > MAX_PDF_OBJECTS || declaredSize > MAX_PDF_OBJECTS * 2) throw new SourceInputError("This PDF is too structurally complex. Paste the relevant SOW text instead.", "PDF_TOO_COMPLEX", 413);
  if (streamCount > MAX_PDF_STREAMS) throw new SourceInputError("This PDF contains too many embedded streams. Paste the relevant SOW text instead.", "PDF_TOO_COMPLEX", 413);
  if (declaredPages > MAX_PDF_PAGES) throw new SourceInputError(`Keep PDF imports to ${MAX_PDF_PAGES} pages or paste the relevant SOW section.`, "PDF_TOO_MANY_PAGES", 413);

  let decodedTotal = 0;
  const streamPattern = /\bstream\r?\n/g;
  for (const match of source.matchAll(streamPattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = source.indexOf("endstream", start);
    if (end < 0) throw new SourceInputError("This PDF contains an unterminated data stream.", "INVALID_PDF");
    const dictionary = source.slice(Math.max(0, (match.index ?? 0) - 2_048), match.index);
    if (!/\/FlateDecode\b/.test(dictionary)) continue;
    let streamEnd = end;
    while (streamEnd > start && (bytes[streamEnd - 1] === 0x0a || bytes[streamEnd - 1] === 0x0d)) streamEnd -= 1;
    try {
      const remaining = MAX_PDF_DECOMPRESSED_BYTES - decodedTotal;
      if (remaining <= 0) throw new SourceInputError("This PDF expands beyond the safe import limit. Paste the relevant SOW text instead.", "PDF_DECOMPRESSION_LIMIT", 413);
      const inflated = inflateSync(bytes.subarray(start, streamEnd), { maxOutputLength: remaining });
      decodedTotal += inflated.byteLength;
    } catch (error) {
      if (error instanceof SourceInputError) throw error;
      throw new SourceInputError("This PDF contains an unsafe or malformed compressed stream. Paste the relevant SOW text instead.", "PDF_DECOMPRESSION_LIMIT", 413);
    }
  }
  return { objectCount, streamCount, declaredPages, decodedTotal };
}

export async function extractSourceFileText(file: File) {
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new SourceInputError("Keep uploads under 1.5 MB so the complete draft can survive sign-in safely.", "FILE_TOO_LARGE", 413);
  if (file.size === 0) throw new SourceInputError("The selected file is empty.", "EMPTY_FILE");
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  if (isPdf) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    preflightPdfBytes(bytes);
    if (!("DOMMatrix" in globalThis)) await import("pdf-parse/worker");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const info = await parser.getInfo();
      if (info.total > MAX_PDF_PAGES) throw new SourceInputError(`Keep PDF imports to ${MAX_PDF_PAGES} pages or paste the relevant SOW section.`, "PDF_TOO_MANY_PAGES", 413);
      const result = await parser.getText({ first: 1, last: info.total });
      const text = normalizeSourceText(result.text);
      if (!text) throw new SourceInputError("No selectable text was found in this PDF. Paste the SOW text instead.", "EMPTY_PDF");
      if (text.length > MAX_EXTRACTED_SOURCE_CHARACTERS) throw new SourceInputError("The extracted PDF text is too long. Paste only the relevant SOW section.", "PDF_TEXT_TOO_LONG", 413);
      return text;
    } finally { await parser.destroy(); }
  }
  if (!isSupportedTextFile(file)) throw new SourceInputError("Upload a PDF, TXT, or Markdown SOW.", "UNSUPPORTED_FILE", 415);
  const text = normalizeSourceText(await file.text());
  if (text.length > MAX_EXTRACTED_SOURCE_CHARACTERS) throw new SourceInputError("This source is too long. Paste only the relevant SOW section.", "SOURCE_TEXT_TOO_LONG", 413);
  return text;
}
