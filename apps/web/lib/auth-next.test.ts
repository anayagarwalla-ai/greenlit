import { describe, expect, it } from "vitest";
import { safeAuthNext } from "./auth-next";

describe("safeAuthNext", () => {
  it("preserves a project-scoped workspace draft through the magic link", () => {
    expect(safeAuthNext("/workspace?draft=550e8400-e29b-41d4-a716-446655440000")).toBe("/workspace?draft=550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects external, malformed, and extra-parameter redirects", () => {
    expect(safeAuthNext("https://evil.example/workspace")).toBe("/dashboard");
    expect(safeAuthNext("/workspace?draft=not-a-uuid")).toBe("/dashboard");
    expect(safeAuthNext("/workspace?draft=550e8400-e29b-41d4-a716-446655440000&next=https://evil.example")).toBe("/dashboard");
  });

  it("preserves only documented Stripe dashboard return states", () => {
    expect(safeAuthNext("/dashboard?stripe=session-expired")).toBe("/dashboard?stripe=session-expired");
    expect(safeAuthNext("/dashboard?stripe=connected")).toBe("/dashboard?stripe=connected");
    expect(safeAuthNext("/dashboard?stripe=unknown")).toBe("/dashboard");
    expect(safeAuthNext("/dashboard?stripe=failed&next=https://evil.example")).toBe("/dashboard");
  });
});
