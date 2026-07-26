import path from "node:path";
import { expect, test } from "@playwright/test";

const axePath = path.resolve(process.cwd(), "workers/runner/node_modules/axe-core/axe.min.js");

type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
};

test("skip link moves focus to the page's main landmark", async ({ page, browserName }) => {
  await page.goto("/");
  // Safari/WebKit uses Option+Tab for links when the macOS full-keyboard
  // access preference is off; Chromium and Firefox use Tab directly.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

for (const route of ["/", "/request-demo", "/resources", "/trust", "/workspace?demo=guided", "/review/demo", "/receipt/demo"]) {
  test(`${route} has no serious or critical automated accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const axe = (window as typeof window & {
        axe: { run: (context: Document, options: object) => Promise<{ violations: AxeViolation[] }> };
      }).axe;
      const result = await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      });
      return result.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            failureSummary: node.failureSummary,
          })),
        }));
    });
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
}
