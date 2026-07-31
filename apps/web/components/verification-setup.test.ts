import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCheck, draftFromCheck, initialDraft, mergeSuggestionIntoDraft, normalizeStagingTarget, verificationRunReadiness } from "./verification-setup";
import type { AnalysisCriterion } from "@/lib/analysis";

function criterion(checkType: AnalysisCriterion["checkType"]): AnalysisCriterion {
  return { id: "AC-01", title: "Contact form succeeds", sourceQuote: "The contact form must show a confirmation.", supported: checkType !== "manual", checkType, rationale: "Browser evidence", grounded: true };
}

describe("custom staging check mapping", () => {
  it("starts target-specific mapping values blank instead of inventing evidence", () => {
    expect(initialDraft()).toMatchObject({
      path: "",
      elementRef: "",
      expectedCount: "",
      expectedPath: "",
      fields: "",
      submitRef: "",
      expectedStatus: "",
    });
  });

  it("rejects role-only placeholder references", () => {
    const draft = { ...initialDraft(), path: "/", elementRef: "button:" };
    expect(() => buildCheck(criterion("element_state"), draft, 0)).toThrow(/accessible role and name/i);
  });

  it("fills blank fields from a grounded scan without overwriting a saved mapping", () => {
    const blank = mergeSuggestionIntoDraft(initialDraft(), { path: "/contact", elementRef: "button:Send" });
    expect(blank).toMatchObject({ path: "/contact", elementRef: "button:Send" });

    const saved = mergeSuggestionIntoDraft(
      { ...initialDraft(), path: "/saved", elementRef: "button:Saved" },
      { path: "/new", elementRef: "button:New" },
    );
    expect(saved).toMatchObject({ path: "/saved", elementRef: "button:Saved" });
  });

  it("refuses a form that could pass without success evidence", () => {
    const draft = { ...initialDraft(), path: "/contact", fields: "Email=qa@example.com", submitRef: "button:Send", mutationAcknowledged: true };
    expect(() => buildCheck(criterion("form_submission"), draft, 0)).toThrow(/needs a success message/i);
  });

  it("builds an explicit, consented form check", () => {
    const draft = { ...initialDraft(), path: "/contact", fields: "Email=qa@example.com", submitRef: "button:Send", successText: "Thanks", expectedPostPath: "/api/leads", mutationAcknowledged: true };
    const check = buildCheck(criterion("form_submission"), draft, 0);
    expect(check.type).toBe("form_submission");
    if (check.type === "form_submission") expect(check.ownerAcknowledgedMutation).toBe(true);
  });

  it("does not invent an HTTP status when an optional status was blank", () => {
    const draft = { ...initialDraft(), path: "/contact", fields: "Email=qa@example.com", submitRef: "button:Send", expectedPostPath: "/api/leads", mutationAcknowledged: true };
    const check = buildCheck(criterion("form_submission"), draft, 0);
    expect(check.type).toBe("form_submission");
    if (check.type !== "form_submission") return;
    expect(check.expectedStatus).toBeUndefined();
    expect(draftFromCheck(check).expectedStatus).toBe("");
  });

  it("maps both standard viewports without arbitrary code", () => {
    const check = buildCheck(criterion("viewport_layout"), { ...initialDraft(), path: "/" }, 0);
    expect(check.type).toBe("viewport_layout");
    if (check.type === "viewport_layout") expect(check.viewports.map((item) => item.width)).toEqual([390, 1280]);
  });

  it("normalizes a bare public hostname to an HTTPS origin", () => {
    expect(normalizeStagingTarget("staging.example.com")).toEqual({ ok: true, normalized: "https://staging.example.com", startPath: "/" });
    expect(normalizeStagingTarget("https://staging.example.com/previews/123?mode=review")).toEqual({
      ok: true,
      normalized: "https://staging.example.com",
      startPath: "/previews/123?mode=review",
    });
    expect(normalizeStagingTarget("http://staging.example.com")).toMatchObject({ ok: false, error: expect.stringMatching(/HTTPS/) });
    expect(normalizeStagingTarget("localhost:3000")).toMatchObject({ ok: false });
  });

  it("keeps Run disabled until origin, consent, label, and mappings are ready", () => {
    const automated = [criterion("element_state")];
    const incomplete = verificationRunReadiness({
      signedInEmail: "owner@example.com",
      busy: false,
      receipt: "signed-origin-receipt",
      verifiedOrigin: "https://staging.example.com",
      evidenceConsent: true,
      buildLabel: "launch-rc1",
      automated,
      drafts: { "AC-01": initialDraft() },
    });
    expect(incomplete.canRun).toBe(false);
    expect(incomplete.blockers).toContain("Complete 1 browser check mapping.");

    const ready = verificationRunReadiness({
      signedInEmail: "owner@example.com",
      busy: false,
      receipt: "signed-origin-receipt",
      verifiedOrigin: "https://staging.example.com",
      evidenceConsent: true,
      buildLabel: "launch-rc1",
      automated,
      drafts: { "AC-01": { ...initialDraft(), path: "/", elementRef: "button:Search" } },
    });
    expect(ready).toMatchObject({ canRun: true, blockers: [], mappingErrors: {} });
  });

  it("rejects build labels longer than 80 characters", () => {
    const automated = [criterion("element_state")];
    const readiness = verificationRunReadiness({
      signedInEmail: "owner@example.com",
      busy: false,
      receipt: "signed-origin-receipt",
      verifiedOrigin: "https://staging.example.com",
      evidenceConsent: true,
      buildLabel: "x".repeat(81),
      automated,
      drafts: { "AC-01": { ...initialDraft(), path: "/", elementRef: "button:Search" } },
    });

    expect(readiness.canRun).toBe(false);
    expect(readiness.blockers).toContain("Keep the build label to 80 characters or fewer.");
  });

  it("keeps consent in document flow and stacks mapping fields on narrow screens", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.mapping-consent\s*\{[^}]*display:\s*grid;/s);
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*?\.setup-fields,\.mapping-fields\s*\{\s*grid-template-columns:\s*1fr;/);
  });
});
