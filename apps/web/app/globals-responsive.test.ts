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

  it("keeps circular proof marks from shrinking into ovals", () => {
    expect(css).toMatch(
      /\.score-ring\s*\{[^}]*width:\s*92px;[^}]*height:\s*92px;[^}]*flex:\s*0 0 92px;[^}]*aspect-ratio:\s*1;/,
    );
    expect(css).toMatch(
      /\.receipt-stamp\s*\{[^}]*width:\s*110px;[^}]*height:\s*110px;[^}]*flex:\s*0 0 110px;[^}]*aspect-ratio:\s*1;/,
    );
  });

  it("renders the source icon as a centered badge without styling its metadata", () => {
    expect(css).toMatch(
      /\.source-title \.source-icon\s*\{[^}]*flex:\s*0 0 36px;[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*border-radius:\s*50%;/,
    );
    expect(css).toMatch(/\.source-title > div > span\s*\{/);
    expect(css).not.toMatch(/\.source-title span\s*\{/);
  });

  it("only pushes real sidebar counts to the trailing edge", () => {
    expect(css).toMatch(/\.side-nav__count\s*\{[^}]*margin-left:\s*auto;/);
    expect(css).not.toMatch(/\.side-nav button span:last-child\s*\{/);
  });

  it("does not reserve obsolete overlay space in the mobile legal footer", () => {
    expect(css).toMatch(
      /\.legal-footer\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*17px 24px 20px;/,
    );
    expect(css).not.toMatch(/\.legal-footer\s*\{[^}]*padding(?:-bottom)?:[^;}]*72px/);
  });
});
