export const checkTypes = [
  "element_state",
  "link_destination",
  "form_submission",
  "viewport_layout",
  "axe_scan",
  "manual",
] as const;

export type CheckType = (typeof checkTypes)[number];

export type AnalysisCriterion = {
  id: string;
  title: string;
  sourceQuote: string;
  supported: boolean;
  checkType: CheckType;
  rationale: string;
  grounded: boolean;
};

export function normalizeSourceText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function normalizeWhitespace(value: string) {
  return value.replace(/[\s\u00a0]+/g, " ").trim();
}

export function isGroundedQuote(source: string, quote: string) {
  const normalizedQuote = normalizeWhitespace(quote);
  return normalizedQuote.length >= 3 && normalizeWhitespace(source).includes(normalizedQuote);
}

export function isCriterionReady(source: string, criterion: Pick<AnalysisCriterion, "title" | "sourceQuote">) {
  return criterion.title.trim().length >= 3 && isGroundedQuote(source, criterion.sourceQuote);
}

export function lineContainsCitation(line: string, citations: string[]) {
  const normalizedLine = normalizeWhitespace(line);
  if (!normalizedLine) return false;
  return citations.some((citation) => {
    const normalizedCitation = normalizeWhitespace(citation);
    return normalizedCitation.includes(normalizedLine) || normalizedLine.includes(normalizedCitation);
  });
}

