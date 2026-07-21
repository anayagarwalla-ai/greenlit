import { describe, expect, it } from "vitest";
import { sanitizeWorkspaceState } from "./workspace-state";

describe("sanitizeWorkspaceState", () => {
  it("removes raw source files and credentials at every nesting level", () => {
    const sanitized = sanitizeWorkspaceState({
      version: 4,
      sourceText: "full confidential document",
      selectedFileMeta: { base64: "secret" },
      reviewUrl: "https://example.test/review/PACKET#t=secret",
      customRun: { targetUrl: "https://staging.example.test", originReceipt: "signed-secret" },
      nested: [{ bearerToken: "secret", safe: true }],
    });

    expect(sanitized).toEqual({
      version: 4,
      customRun: { targetUrl: "https://staging.example.test" },
      nested: [{ safe: true }],
      sourcePersisted: false,
    });
  });

  it("retains resumable criteria, mappings, results, and exact source quotes", () => {
    const sanitized = sanitizeWorkspaceState({
      criteria: [{ id: "AC-01", sourceQuote: "The CTA must reach contact." }],
      confirmed: { "AC-01": true },
      customRun: { checks: [{ criterionId: "AC-01", path: "/" }] },
      latestRun: { runId: "RUN-1", results: [{ criterionId: "AC-01", status: "PASS" }] },
    });

    expect(sanitized).toMatchObject({
      criteria: [{ id: "AC-01", sourceQuote: "The CTA must reach contact." }],
      confirmed: { "AC-01": true },
      customRun: { checks: [{ criterionId: "AC-01", path: "/" }] },
      latestRun: { runId: "RUN-1" },
      sourcePersisted: false,
    });
  });
});
