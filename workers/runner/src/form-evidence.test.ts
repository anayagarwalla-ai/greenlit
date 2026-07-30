import { describe, expect, it } from "vitest";
import { expectedPostResponseLabel, postResponsePassed } from "./form-evidence";

describe("form POST response evidence", () => {
  it("requires a successful response when a POST path is observed without an exact status", () => {
    expect(postResponsePassed("/api/leads", 201, undefined)).toBe(true);
    expect(postResponsePassed("/api/leads", 302, undefined)).toBe(true);
    expect(postResponsePassed("/api/leads", 500, undefined)).toBe(false);
    expect(postResponsePassed("/api/leads", undefined, undefined)).toBe(false);
    expect(expectedPostResponseLabel("/api/leads", undefined)).toBe(" + HTTP 2xx–3xx");
  });

  it("continues to enforce an explicitly mapped status", () => {
    expect(postResponsePassed("/api/leads", 201, 201)).toBe(true);
    expect(postResponsePassed("/api/leads", 200, 201)).toBe(false);
    expect(expectedPostResponseLabel("/api/leads", 201)).toBe(" + HTTP 201");
  });
});
