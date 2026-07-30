import { isGroundedQuote, normalizeSourceText, normalizeWhitespace, type AnalysisCriterion, type CheckType } from "./analysis";

const MAX_FALLBACK_CRITERIA = 8;
const MAX_QUOTE_LENGTH = 900;

export type LocalFallbackReason =
  | "unavailable"
  | "not_configured"
  | "region_restricted"
  | "consent_record_unavailable";

export const LOCAL_FALLBACK_MODEL = "Greenlit local source parser";

const localFallbackNotices: Record<LocalFallbackReason, string> = {
  unavailable: "Gemini did not return usable source-grounded criteria, so Greenlit's local source parser created this draft instead. The SOW may already have been sent to Gemini before the provider failed. Review every item before continuing.",
  not_configured: "Gemini is not configured. Greenlit did not send this SOW to Google; its local source parser created this source-grounded draft instead. Review every item before continuing.",
  region_restricted: "Gemini's unpaid API tier is not offered for this region. Greenlit did not send this SOW to Google; its local source parser created this source-grounded draft instead. Review every item before continuing.",
  consent_record_unavailable: "Greenlit could not retain the consent record required for Gemini processing, so it did not send this SOW to Google. Its local source parser created this source-grounded draft instead. Review every item before continuing.",
};

export function localFallbackNotice(reason: LocalFallbackReason): string {
  return localFallbackNotices[reason];
}

const requirementPattern = /\b(must|shall|should|will|needs? to|required|requires?|at least|no more than|within|acceptance|deliver(?:able|ables)?|ensure)\b/i;
const browserEvidencePattern = /\b(page|screen|website|site|homepage|button|link|navigation|menu|form|field|headline|section|viewport|mobile|desktop|redirect|visible|display|submit|accessib|wcag|aria|scroll|layout|http|url|path)\b/i;
const headingPattern = /^(statement of work|scope of work|acceptance criteria|deliverables?|project|milestone|overview|background|objectives?|timeline|terms?)\b.{0,45}:?$/i;
const administrativePattern = /(?:[$€£]\s?\d|\b(?:usd|eur|gbp|payment terms?|invoice|effective date|governing law)\b)/i;

type DraftCriterion = Omit<AnalysisCriterion, "id">;

function sourceSegments(source: string) {
  const segments: string[] = [];
  for (const rawLine of normalizeSourceText(source).split("\n")) {
    const line = rawLine.trim();
    if (line.length < 12) continue;
    const parts = line.match(/[^.!?;]+(?:[.!?;]+|$)/g) ?? [line];
    for (const rawPart of parts) {
      const part = rawPart.trim();
      if (part.length >= 12 && part.length <= MAX_QUOTE_LENGTH) segments.push(part);
    }
  }
  return [...new Map(segments.map((segment) => [normalizeWhitespace(segment).toLowerCase(), segment])).values()];
}

function criterionTitle(quote: string) {
  const cleaned = quote
    .replace(/^\s*(?:[-*•]|\d+[.)]|[a-z][.)])\s+/i, "")
    .replace(/[.;:]+$/, "")
    .trim();
  if (cleaned.length <= 157) return cleaned;
  const shortened = cleaned.slice(0, 156).replace(/\s+\S*$/, "").trim();
  return `${shortened}…`;
}

function evidenceStrategy(quote: string): { checkType: CheckType; supported: boolean; rationale: string } {
  const value = quote.toLowerCase();

  if (/\b(subjective|satisfaction|approve|approval|revenue|conversion|sales|successful campaign|brand voice|look and feel|visually|beautiful|modern)\b/.test(value)) {
    return { checkType: "manual", supported: false, rationale: "A person must review this subjective or business outcome against the agreed scope." };
  }
  if (/\b(accessib|wcag|aria|programmatically associated|screen reader|keyboard|contrast)\b/.test(value)) {
    return { checkType: "axe_scan", supported: true, rationale: "Run an accessibility scan and inspect the relevant semantic relationship." };
  }
  if (/\b(viewport|mobile|desktop|responsive|horizontal scroll|overflow|layout|\d{3,4}px)\b/.test(value)) {
    return { checkType: "viewport_layout", supported: true, rationale: "Check the rendered layout at the specified viewport and measure overflow or visibility." };
  }
  if (/\b(form|field|submit|submission|lead|confirmation|validation error)\b/.test(value)) {
    return { checkType: "form_submission", supported: true, rationale: "Submit safe staging inputs and verify the visible result and expected network response." };
  }
  if (
    /\b(navigate|redirect|destination|take visitors|url|path|links? to|reaches?|goes? to|leads? to)\b/.test(value)
    || /\bopens?\b.{0,80}\b(page|route|url|path|destination)\b/.test(value)
  ) {
    return { checkType: "link_destination", supported: true, rationale: "Activate the named control and verify its final same-origin destination." };
  }
  if (/\b(visible|displays?|present|contains?|includes?|shows?|headline|section|button|image|count|exactly|at least|no more than)\b/.test(value)) {
    return { checkType: "element_state", supported: true, rationale: "Inspect the rendered page for the named element, content, state, or count." };
  }
  return { checkType: "manual", supported: false, rationale: "Confirm this promise manually and define a safe automated check before verification." };
}

function draftCriterion(source: string, quote: string): DraftCriterion {
  const strategy = evidenceStrategy(quote);
  return {
    title: criterionTitle(quote),
    sourceQuote: quote,
    ...strategy,
    grounded: isGroundedQuote(source, quote),
  };
}

export function buildFallbackCriteria(source: string): DraftCriterion[] {
  const normalizedSource = normalizeSourceText(source);
  const segments = sourceSegments(normalizedSource);
  const requirements = segments.filter((segment) => requirementPattern.test(segment) && !headingPattern.test(segment) && !administrativePattern.test(segment));
  const evidenceReady = segments.filter((segment) => browserEvidencePattern.test(segment) && !headingPattern.test(segment));
  const candidates = requirements.length > 0 ? requirements : evidenceReady.length > 0 ? evidenceReady : segments;

  return candidates
    .slice(0, MAX_FALLBACK_CRITERIA)
    .map((quote) => draftCriterion(normalizedSource, quote))
    .filter((criterion) => criterion.grounded);
}
