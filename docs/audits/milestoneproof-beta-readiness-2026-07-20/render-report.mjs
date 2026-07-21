import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const inputUrl = new URL("./report.html", import.meta.url).href;
const outputPath = fileURLToPath(new URL("./MilestoneProof-Beta-Readiness-Audit.pdf", import.meta.url));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(inputUrl, { waitUntil: "load" });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images, (image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          }),
    ),
  );
});

await page.pdf({
  path: outputPath,
  format: "Letter",
  printBackground: true,
  preferCSSPageSize: true,
  tagged: true,
  outline: true,
});

await browser.close();
