import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const responsiveFixes = css.slice(css.indexOf("/* Responsive workflow continuity"));

describe("responsive workflow CSS", () => {
  it("keeps workflow navigation visible below desktop width", () => {
    expect(responsiveFixes).toMatch(
      /@media \(max-width: 980px\)[\s\S]*?\.app-sidebar\s*\{[^}]*display:\s*block;/,
    );
    expect(responsiveFixes).toMatch(
      /\.app-sidebar \.side-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\);/,
    );
    expect(responsiveFixes).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.app-sidebar \.side-nav\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\);/,
    );
  });

  it("allows imported, generated, review, and record text to reflow", () => {
    expect(responsiveFixes).toMatch(
      /\.upload-drop > span:nth-child\(2\),[\s\S]*?\.receipt-criterion > div\s*\{[^}]*min-width:\s*0;/,
    );
    expect(responsiveFixes).toMatch(
      /\.upload-drop strong,[\s\S]*?\.receipt-invoice p\s*\{[^}]*overflow-wrap:\s*anywhere;/,
    );
    expect(responsiveFixes).toMatch(
      /\.receipt-page__foot\s*\{[^}]*position:\s*static;[^}]*overflow-wrap:\s*anywhere;/,
    );
  });
});
