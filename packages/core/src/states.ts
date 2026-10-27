import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Page, type Route } from "playwright";
import { writeJsonAtomic } from "./fitroom-store";

export type StateName = "empty" | "loading" | "error" | "long" | "dark";
export type StateStatus = "pass" | "fail" | "not_reachable";

export interface StateResult {
  state: StateName;
  status: StateStatus;
  reason: string;
  citation?: string;
  related?: string[];
  severity?: number;
  screenshots: string[];
}

export interface StatesReport {
  version: 1;
  route: string;
  createdAt: string;
  states: StateResult[];
}

export interface CheckStateInput {
  baseUrl: string;
  outputDir?: string;
  projectRoot: string;
  route: string;
  state: StateName;
}

export interface CheckStatesInput {
  baseUrl: string;
  outputDir?: string;
  projectRoot: string;
  route: string;
}

const require = createRequire(import.meta.url);
const axeScriptPath = require.resolve("axe-core/axe.min.js");
const stateOrder: StateName[] = ["empty", "loading", "error", "long", "dark"];

function pageSlug(route: string): string {
  if (route === "/") {
    return "root";
  }

  return (
    route
      .replace(/^\/+|\/+$/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "root"
  );
}

function pageUrl(baseUrl: string, route: string): string {
  return new URL(route, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function tripleStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.repeat(3);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => tripleStrings(entry));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, tripleStrings(entry)]),
    );
  }

  return value;
}

function longPayload(): unknown {
  return [
    {
      name: "A very long project name that keeps going and going so we can see how the layout handles it at narrow widths",
      description:
        "This description is intentionally long so it wraps across several lines at 320 pixels and never clips the content",
    },
  ];
}

async function installApiRoute(
  page: Page,
  origin: string,
  state: StateName,
  counters: { calls: number },
  releases: Array<() => void>,
): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const type = request.resourceType();

    if (url.origin !== origin || (type !== "fetch" && type !== "xhr")) {
      await route.continue();
      return;
    }

    counters.calls += 1;

    if (state === "empty") {
      await route.fulfill({
        body: "[]",
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    if (state === "error") {
      await route.fulfill({
        body: '{"error":"failed"}',
        contentType: "application/json",
        status: 500,
      });
      return;
    }

    if (state === "long") {
      await route.fulfill({
        body: JSON.stringify(tripleStrings(longPayload())),
        contentType: "application/json",
        status: 200,
      });
      return;
    }

    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    await route
      .fulfill({
        body: "[]",
        contentType: "application/json",
        status: 200,
      })
      .catch(() => {});
  });
}

async function visibleState(page: Page): Promise<{
  hasMessage: boolean;
  hasNextStep: boolean;
}> {
  return page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    // biome-ignore lint/performance/useDomNodeTextContent: this checks the text a person can see
    const text = document.body.innerText.toLowerCase();
    const controls = [...document.querySelectorAll("a, button")].filter(visible);

    return {
      hasMessage: /(no |nothing|empty|none yet)/i.test(text),
      hasNextStep: controls.some((control) => (control.textContent ?? "").trim() !== ""),
    };
  });
}

async function loadingIndicatorVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const selectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[role="status"]',
      ".skeleton",
      ".spinner",
    ];

    return selectors.some((selector) =>
      [...document.querySelectorAll(selector)].some((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      }),
    );
  });
}

async function errorState(page: Page): Promise<{ hasProblem: boolean; hasRecovery: boolean }> {
  return page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    // biome-ignore lint/performance/useDomNodeTextContent: this checks the text a person can see
    const text = document.body.innerText.toLowerCase();
    const controls = [...document.querySelectorAll("a, button")].filter(visible);
    const recovery = /(retry|try again|go back|back|contact|support|reload)/i;

    return {
      hasProblem: /(could not|error|failed|problem|went wrong)/i.test(text),
      hasRecovery: controls.some((control) => recovery.test(control.textContent ?? "")),
    };
  });
}

async function repeatHeadings(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("h1, h2, h3, h4, h5, h6, label")) {
      const text = (element.textContent ?? "").trim();

      if (text !== "") {
        element.textContent = `${text} ${text} ${text}`;
      }
    }
  });
}

async function longTextOverflows(page: Page): Promise<{ overflows: boolean; reason: string }> {
  return page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;

    if (scrollWidth > clientWidth + 1) {
      return {
        overflows: true,
        reason: `The page scrolls horizontally at ${clientWidth} pixels (${scrollWidth} pixels wide).`,
      };
    }

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(element);

      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }

      if (
        (style.overflowX === "hidden" || style.overflow === "hidden") &&
        element.scrollWidth > element.clientWidth + 1
      ) {
        return {
          overflows: true,
          reason: "Text is clipped inside a container that hides overflow.",
        };
      }
    }

    return { overflows: false, reason: "Text wraps without clipping or horizontal scroll." };
  });
}

interface AxeContrastResult {
  violations: Array<{ id: string }>;
}

async function darkContrastViolations(page: Page): Promise<number> {
  await page.addScriptTag({ path: axeScriptPath });

  const result = await page.evaluate(async () => {
    const runner = (
      window as Window & {
        axe?: {
          run: (
            context: Document,
            options: {
              runOnly: { type: "rule"; values: string[] };
            },
          ) => Promise<AxeContrastResult>;
        };
      }
    ).axe;

    if (runner === undefined) {
      throw new Error("axe-core did not load.");
    }

    return runner.run(document, {
      runOnly: { type: "rule", values: ["color-contrast"] },
    });
  });

  return result.violations.length;
}

async function result(
  page: Page,
  state: StateName,
  screenshotPaths: string[],
): Promise<StateResult> {
  if (state === "empty") {
    const empty = await visibleState(page);

    if (empty.hasMessage && empty.hasNextStep) {
      return {
        state,
        status: "pass",
        reason: "The empty state explains what is missing and offers a next step.",
        screenshots: screenshotPaths,
      };
    }

    return {
      state,
      status: "fail",
      reason: empty.hasMessage
        ? "The empty state has no next step."
        : "The empty state does not explain what is missing.",
      citation: "nielsen-h1",
      related: ["nielsen-h10"],
      severity: 2,
      screenshots: screenshotPaths,
    };
  }

  if (state === "loading") {
    if (await loadingIndicatorVisible(page)) {
      return {
        state,
        status: "pass",
        reason: "A loading indicator is visible within 1 second.",
        screenshots: screenshotPaths,
      };
    }

    return {
      state,
      status: "fail",
      reason: "No loading indicator is visible within 1 second.",
      citation: "nielsen-h1",
      severity: 2,
      screenshots: screenshotPaths,
    };
  }

  if (state === "error") {
    const error = await errorState(page);

    if (error.hasProblem && error.hasRecovery) {
      return {
        state,
        status: "pass",
        reason: "The error state names the problem and offers a way to recover.",
        screenshots: screenshotPaths,
      };
    }

    return {
      state,
      status: "fail",
      reason: error.hasProblem
        ? "The error state does not offer a way to recover."
        : "The error state does not name the problem.",
      citation: "nielsen-h9",
      severity: 2,
      screenshots: screenshotPaths,
    };
  }

  if (state === "long") {
    const overflow = await longTextOverflows(page);

    return {
      state,
      status: overflow.overflows ? "fail" : "pass",
      reason: overflow.reason,
      ...(overflow.overflows
        ? {
            citation: "wcag22-1.4.10",
            related: ["wcag22-1.4.12"],
            severity: 2,
          }
        : {}),
      screenshots: screenshotPaths,
    };
  }

  const violations = await darkContrastViolations(page);

  if (violations === 0) {
    return {
      state,
      status: "pass",
      reason: "The full contrast audit passes in dark mode.",
      screenshots: screenshotPaths,
    };
  }

  return {
    state,
    status: "fail",
    reason: `The dark mode contrast audit found ${violations} contrast problem${violations === 1 ? "" : "s"}.`,
    citation: "wcag22-1.4.3",
    related: ["wcag22-1.4.11"],
    severity: 2,
    screenshots: screenshotPaths,
  };
}

export async function checkState(input: CheckStateInput): Promise<StateResult> {
  if (input.state === "dark") {
    return checkDarkState(input);
  }

  const pageName = pageSlug(input.route);
  const screenshotDirectory = path.join(
    input.outputDir ?? path.join(input.projectRoot, ".fitroom", "states"),
    pageName,
  );
  const screenshots: string[] = [];
  const counters = { calls: 0 };
  const releases: Array<() => void> = [];
  const origin = new URL(input.baseUrl).origin;

  await mkdir(screenshotDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: input.state === "long" ? 320 : 1440, height: 900 },
    });
    const page = await context.newPage();

    await installApiRoute(page, origin, input.state, counters, releases);

    if (input.state === "loading") {
      await page.goto(pageUrl(input.baseUrl, input.route), {
        timeout: 10_000,
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1_500);
    } else {
      await page.goto(pageUrl(input.baseUrl, input.route), { waitUntil: "load" });
      await page.waitForTimeout(350);
    }

    if (input.state === "long") {
      await repeatHeadings(page);
      await page.waitForTimeout(100);
    }

    const screenshotPath = path.join(
      screenshotDirectory,
      `${input.state}-${input.state === "long" ? 320 : 1440}.png`,
    );

    await page.screenshot({ fullPage: true, path: screenshotPath });
    screenshots.push(screenshotPath);

    for (const release of releases) {
      release();
    }

    if (counters.calls === 0 && input.state !== "long") {
      return {
        state: input.state,
        status: "not_reachable",
        reason: "This page makes no same-origin API calls.",
        screenshots,
      };
    }

    return await result(page, input.state, screenshots);
  } finally {
    await browser.close();
  }
}

async function checkDarkState(input: CheckStateInput): Promise<StateResult> {
  const pageName = pageSlug(input.route);
  const screenshotDirectory = path.join(
    input.outputDir ?? path.join(input.projectRoot, ".fitroom", "states"),
    pageName,
  );
  const screenshotPath = path.join(screenshotDirectory, "dark-1440.png");

  await mkdir(screenshotDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      colorScheme: "dark",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(pageUrl(input.baseUrl, input.route), { waitUntil: "load" });
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.screenshot({ fullPage: true, path: screenshotPath });

    return await result(page, "dark", [screenshotPath]);
  } finally {
    await browser.close();
  }
}

export async function checkStates(input: CheckStatesInput): Promise<StatesReport> {
  const states: StateResult[] = [];

  for (const state of stateOrder) {
    states.push(
      await checkState({
        baseUrl: input.baseUrl,
        ...(input.outputDir === undefined ? {} : { outputDir: input.outputDir }),
        projectRoot: input.projectRoot,
        route: input.route,
        state,
      }),
    );
  }

  const report: StatesReport = {
    version: 1,
    route: input.route,
    createdAt: new Date().toISOString(),
    states,
  };

  await writeJsonAtomic(
    path.join(input.outputDir ?? path.join(input.projectRoot, ".fitroom", "states"), "report.json"),
    report,
  );

  return report;
}
