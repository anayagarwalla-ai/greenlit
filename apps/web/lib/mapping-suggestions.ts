import type { AnalysisCriterion } from "./analysis";

export type MappingCandidate = {
  id: string;
  path: string;
  role: string;
  name: string;
  ref: string;
  visible: true;
  enabled: boolean;
  matchCount: number;
  unique: boolean;
  href?: string;
  form?: {
    action?: string;
    method: "get" | "post";
    fields: Array<{
      label: string;
      controlType: "text" | "email" | "tel" | "url" | "search" | "textarea" | "select" | "checkbox" | "radio" | "other";
      required: boolean;
    }>;
  };
};

export type MappingDraftHint = {
  path?: string;
  elementRef?: string;
  expectedPath?: string;
  fields?: string;
  submitRef?: string;
  expectedPostPath?: string;
};

export type MappingSuggestion = {
  criterionId: string;
  status: "suggested" | "ambiguous" | "unresolved" | "not_needed";
  choices: MappingCandidate[];
  recommendedId?: string;
  draft?: MappingDraftHint;
  confidence: number;
  explanation: string;
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "must", "of", "on", "or",
  "page", "section", "should", "that", "the", "their", "this", "to", "was", "with",
]);

function tokens(value: string): string[] {
  return Array.from(new Set((value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))));
}

export function mappingIntentTerms(criteria: AnalysisCriterion[]): string[] {
  return Array.from(new Set(criteria.flatMap((criterion) => tokens(
    `${criterion.title} ${criterion.sourceQuote} ${criterion.rationale}`,
  ))))
    .filter((term) => term.length <= 32)
    .slice(0, 24);
}

function semanticOverlap(criterion: AnalysisCriterion, candidate: MappingCandidate): number {
  const intent = tokens(`${criterion.title} ${criterion.sourceQuote} ${criterion.rationale}`);
  const formLabels = candidate.form?.fields.map((field) => field.label).join(" ") ?? "";
  const target = new Set(tokens(`${candidate.name} ${candidate.path} ${candidate.href ?? ""} ${formLabels}`));
  return intent.reduce((sum, token) => sum + (target.has(token) ? 1 : 0), 0);
}

function overlapScore(criterion: AnalysisCriterion, candidate: MappingCandidate): number {
  const overlap = semanticOverlap(criterion, candidate);
  let score = overlap * 3;
  const lowerTitle = criterion.title.toLowerCase();
  const lowerName = candidate.name.toLowerCase();
  if (lowerName.length >= 4 && (lowerTitle.includes(lowerName) || (lowerTitle.length >= 4 && lowerName.includes(lowerTitle)))) score += 7;
  if (candidate.enabled) score += 1;
  if (candidate.unique) score += 2;
  if (candidate.path === "/") score += 1;

  if (criterion.checkType === "link_destination" && candidate.href) score += 5;
  if (criterion.checkType === "form_submission" && candidate.form) {
    score += 5;
    if (/(send|submit|request|contact|save|create)/i.test(candidate.name)) score += 4;
  }
  if (criterion.checkType === "element_state" && ["heading", "button", "link", "region", "img"].includes(candidate.role)) score += 2;
  return score;
}

function compatible(criterion: AnalysisCriterion, candidate: MappingCandidate): boolean {
  if (!candidate.visible || !candidate.unique) return false;
  if (criterion.checkType === "link_destination") return candidate.role === "link" || candidate.role === "button";
  if (criterion.checkType === "form_submission") {
    const safeFieldTypes = new Set(["text", "email", "tel", "url", "search", "textarea"]);
    return candidate.role === "button"
      && candidate.enabled
      && Boolean(candidate.form)
      && Boolean(candidate.form?.fields.some((field) => safeFieldTypes.has(field.controlType)))
      && Boolean(candidate.form?.fields.every((field) => !field.required || safeFieldTypes.has(field.controlType)));
  }
  if (criterion.checkType === "element_state") return ["button", "link", "heading", "region", "img"].includes(candidate.role);
  return false;
}

function safeTestValue(controlType: NonNullable<MappingCandidate["form"]>["fields"][number]["controlType"]): string | undefined {
  if (controlType === "email") return "qa+greenlit@example.com";
  if (controlType === "tel") return "5550100199";
  if (controlType === "url") return "https://example.com";
  if (["text", "search", "textarea"].includes(controlType)) return "Greenlit verification test";
  return undefined;
}

export function draftHintForCandidate(criterion: AnalysisCriterion, candidate: MappingCandidate): MappingDraftHint {
  if (criterion.checkType === "element_state") {
    return { path: candidate.path, elementRef: candidate.ref };
  }
  if (criterion.checkType === "link_destination") {
    return {
      path: candidate.path,
      elementRef: candidate.ref,
      ...(candidate.href ? { expectedPath: candidate.href } : {}),
    };
  }
  if (criterion.checkType === "form_submission") {
    const fields = candidate.form?.fields
      .map((field) => {
        const value = safeTestValue(field.controlType);
        return value ? `${field.label}=${value}` : "";
      })
      .filter(Boolean)
      .join("\n");
    return {
      path: candidate.path,
      submitRef: candidate.ref,
      ...(fields ? { fields } : {}),
      ...(candidate.form?.method === "post" && candidate.form.action ? { expectedPostPath: candidate.form.action } : {}),
    };
  }
  return { path: candidate.path };
}

export function suggestMappings(criteria: AnalysisCriterion[], candidates: MappingCandidate[], pages: string[]): MappingSuggestion[] {
  return criteria.map((criterion) => {
    if (!criterion.supported || criterion.checkType === "manual") {
      return {
        criterionId: criterion.id,
        status: "not_needed",
        choices: [],
        confidence: 1,
        explanation: "This promise stays in client review and does not need a browser target.",
      };
    }
    if (criterion.checkType === "viewport_layout" || criterion.checkType === "axe_scan") {
      return {
        criterionId: criterion.id,
        status: "suggested",
        choices: [],
        confidence: 1,
        draft: { path: pages[0] ?? "/" },
        explanation: `Greenlit will check the discovered page ${pages[0] ?? "/"}.`,
      };
    }

    const ranked = candidates
      .filter((candidate) => compatible(criterion, candidate))
      .map((candidate) => ({ candidate, score: overlapScore(criterion, candidate), semanticOverlap: semanticOverlap(criterion, candidate) }))
      .sort((left, right) => right.score - left.score || left.candidate.path.localeCompare(right.candidate.path) || left.candidate.name.localeCompare(right.candidate.name))
      .slice(0, 5);
    const best = ranked[0];
    if (!best) {
      return {
        criterionId: criterion.id,
        status: "unresolved",
        choices: [],
        confidence: 0,
        explanation: "No unique accessible control matched this promise. Choose a different page or use the advanced mapping.",
      };
    }

    const runnerUp = ranked[1];
    const hasGroundedIntentMatch = best.semanticOverlap > 0;
    const highConfidence = hasGroundedIntentMatch && best.score >= 8 && (!runnerUp || best.score - runnerUp.score >= 3);
    const onlyPlausibleChoice = hasGroundedIntentMatch && ranked.length === 1 && best.score >= 4;
    const suggested = highConfidence || onlyPlausibleChoice;
    const confidence = Math.max(0, Math.min(1, best.score / Math.max(12, best.score + (runnerUp?.score ?? 0))));
    return {
      criterionId: criterion.id,
      status: suggested ? "suggested" : "ambiguous",
      choices: ranked.map((item) => item.candidate),
      ...(suggested ? { recommendedId: best.candidate.id, draft: draftHintForCandidate(criterion, best.candidate) } : {}),
      confidence,
      explanation: suggested
        ? `Matched to the real ${best.candidate.role} “${best.candidate.name}” on ${best.candidate.path}.`
        : "Several real controls could match this promise. Choose the intended one instead of typing an exact name.",
    };
  });
}
