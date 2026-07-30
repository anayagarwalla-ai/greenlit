export type AnalysisMode = "gemini" | "fallback";

export function analysisResultPresentation(mode: AnalysisMode, criteriaCount: number, durationMs?: number) {
  const timing = durationMs ? ` in ${(durationMs / 1000).toFixed(1)}s` : "";
  return mode === "fallback"
    ? {
        badge: "Local parser import",
        noticeHeading: "Local source-grounded fallback",
        toast: `${criteriaCount} criteria drafted by the local parser${timing}`,
      }
    : {
        badge: "Gemini import",
        noticeHeading: "Gemini source analysis",
        toast: `${criteriaCount} Gemini criteria drafted${timing}`,
      };
}
