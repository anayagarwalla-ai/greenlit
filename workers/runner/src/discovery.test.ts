import { describe, expect, it } from "vitest";
import { ariaSnapshotName, relevantCrawlPath, safeSameOriginPath } from "./discovery";

describe("ariaSnapshotName", () => {
  it("reads browser-computed names from interactive and structural entries", () => {
    expect(ariaSnapshotName('- button "Send request"', "button")).toBe("Send request");
    expect(ariaSnapshotName('- heading "Contact us" [level=2]', "heading")).toBe("Contact us");
    expect(ariaSnapshotName('- link "Plans: summer"', "link")).toBe("Plans: summer");
  });

  it("preserves escaped quotes while rejecting unnamed or mismatched entries", () => {
    expect(ariaSnapshotName('- button "Save \\"Spring launch\\""', "button")).toBe('Save "Spring launch"');
    expect(ariaSnapshotName("- button", "button")).toBe("");
    expect(ariaSnapshotName('- link "Contact"', "button")).toBe("");
  });
});

describe("safeSameOriginPath", () => {
  it("resolves relative and hash links against the current page", () => {
    expect(safeSameOriginPath("next", "https://staging.example/docs/start", "https://staging.example")).toBe("/docs/next");
    expect(safeSameOriginPath("#details", "https://staging.example/docs/start", "https://staging.example")).toBe("/docs/start#details");
  });

  it("rejects links that resolve outside the verified origin", () => {
    expect(safeSameOriginPath("https://attacker.example/", "https://staging.example/docs/start", "https://staging.example")).toBeUndefined();
  });
});

describe("relevantCrawlPath", () => {
  it("follows only safe public paths that overlap the confirmed criteria", () => {
    expect(relevantCrawlPath("/contact", "Contact us", ["contact", "form"])).toBe("/contact");
    expect(relevantCrawlPath("/pricing", "Pricing", ["contact", "form"])).toBeUndefined();
    expect(relevantCrawlPath("/logout", "Contact", ["contact"])).toBeUndefined();
    expect(relevantCrawlPath("/contact?delete=true", "Contact", ["contact"])).toBeUndefined();
  });
});
