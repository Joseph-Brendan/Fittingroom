import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const url = process.argv[2];
const screenshotRoot = process.argv[3] ?? "test-reports/screenshots/round-3";

if (url === undefined) {
  throw new Error("Pass the board URL.");
}

await mkdir(screenshotRoot, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

await page.goto(url, { waitUntil: "load" });
await page.getByText("No directions yet.", { exact: true }).waitFor();
await page.screenshot({ path: `${screenshotRoot}/board-empty.png`, fullPage: true });

const address = page.url();
const tokenized = address.includes("token=");
const tokenless = await context.newPage();
const refused = await tokenless.goto(new URL("/", address).toString(), { waitUntil: "load" });
const refusedStatus = refused?.status() ?? 0;
await tokenless.close();

const options = await page.getByLabel("Page group").locator("option").allTextContents();
const selected = await page.getByLabel("Page group").inputValue();
const banner = (await page.locator(".design-system-banner").textContent()) ?? "";
const title = (await page.getByText("No directions yet.", { exact: true }).textContent()) ?? "";
const copy =
  (await page
    .getByText("Run an audit and generate directions, or click Generate directions.", {
      exact: true,
    })
    .textContent()) ?? "";
const button =
  (await page.getByRole("button", { name: "Generate directions" }).textContent()) ?? "";

console.log(
  JSON.stringify(
    {
      address,
      startsWithLocalhost: address.startsWith("http://127.0.0.1"),
      tokenized,
      refusedStatus,
      selected,
      options,
      banner,
      title,
      copy,
      button,
      screenshot: `${screenshotRoot}/board-empty.png`,
    },
    null,
    2,
  ),
);

await browser.close();
