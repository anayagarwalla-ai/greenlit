import { describe, expect, it } from "vitest";
import { analysisResultPresentation } from "../lib/analysis-presentation";

describe("SOW analysis result presentation", () => {
  it("labels deterministic fallback output as local and source-grounded", () => {
    expect(analysisResultPresentation("fallback", 3, 1_250)).toEqual({
      badge: "Local parser import",
      noticeHeading: "Local source-grounded fallback",
      toast: "3 criteria drafted by the local parser in 1.3s",
    });
  });

  it("keeps successful provider output explicitly attributed to Gemini", () => {
    expect(analysisResultPresentation("gemini", 2)).toEqual({
      badge: "Gemini import",
      noticeHeading: "Gemini source analysis",
      toast: "2 Gemini criteria drafted",
    });
  });
});
