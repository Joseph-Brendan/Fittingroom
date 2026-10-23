import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const sessionPath = path.resolve("e2e", ".board-session.json");
const session = JSON.parse(await readFile(sessionPath, "utf8"));
const screenshotRoot = "test-reports/screenshots/round-3/e2e";

await mkdir(screenshotRoot, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

await page.goto(session.url, { waitUntil: "load" });
const cards = page.locator("article.variant-card");

await cards.first().waitFor();

const names = await page.locator("article.variant-card h2").allTextContents();
const iframes = page.locator("iframe");
const widths = await iframes.evaluateAll((elements) =>
  elements.map((element) => element.getAttribute("width")),
);

await page.screenshot({ path: `${screenshotRoot}/board-1440.png`, fullPage: true });

await page.getByRole("button", { name: "375 px" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${screenshotRoot}/board-375.png`, fullPage: true });

await page.getByRole("button", { name: "768 px" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${screenshotRoot}/board-768.png`, fullPage: true });

await page.getByRole("button", { name: "1440 px" }).click();
await page.getByRole("button", { name: "Findings (3)" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${screenshotRoot}/board-findings.png`, fullPage: true });

const drawerVisible = await page
  .getByRole("complementary", { name: "Findings drawer" })
  .isVisible();

console.log(
  JSON.stringify(
    {
      cardCount: await cards.count(),
      names,
      widths,
      drawerVisible,
      screenshots: [
        `${screenshotRoot}/board-1440.png`,
        `${screenshotRoot}/board-375.png`,
        `${screenshotRoot}/board-768.png`,
        `${screenshotRoot}/board-findings.png`,
      ],
    },
    null,
    2,
  ),
);

await browser.close();
