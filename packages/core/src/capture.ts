import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { PageGroup } from "./routes";
import { findScope, loadScopes, normalizePagePath } from "./scopes";

export const CAPTURE_WIDTHS = [375, 768, 1440] as const;

export type CaptureWidth = (typeof CAPTURE_WIDTHS)[number];

export interface CaptureSelection {
  id: string;
  name: string;
  pages: string[];
}

export interface ScopeSummary {
  id: string;
  name: string;
  pages: string[];
  estimatedSeconds: number;
  message: string;
}

export interface CaptureOptions {
  projectRoot?: string;
  outputDir?: string;
  onScope?: (summary: ScopeSummary) => void | Promise<void>;
}

export interface PageScreenshot {
  width: CaptureWidth;
  path: string;
}

export interface CapturedElement {
  attributes: Record<string, string>;
  children: Array<{ childCount: number; signature: string; textLength: number }>;
  classes: string[];
  directText: string;
  rect: { height: number; left: number; top: number; width: number };
  selector: string;
  styles: {
    backgroundColor: string;
    backgroundImage: string;
    borderRadius: string;
    boxShadow: string;
    display: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    textAlign: string;
  };
  tag: string;
  text: string;
}

export interface SlopEvidence {
  elements: CapturedElement[];
  path: string;
}

export interface CapturedPage {
  path: string;
  url: string;
  screenshots: PageScreenshot[];
  accessibilityTreePath: string;
  slopEvidencePath: string;
}

export interface CaptureResult {
  summary: ScopeSummary;
  pages: CapturedPage[];
}

export function formatCaptureSummary(name: string, pages: readonly string[]): string {
  const pageCount = `${pages.length} ${pages.length === 1 ? "page" : "pages"}`;

  return `Capturing: ${name} (${pageCount}): ${pages.join(" ")}, at 375, 768 and 1440 px.`;
}

function routeSlug(routePath: string): string {
  if (routePath === "/") {
    return "root";
  }

  return routePath
    .replace(/^\//, "")
    .replace(/\[/g, "")
    .replace(/\]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function routeUrl(appUrl: string, routePath: string): string {
  const baseUrl = appUrl.endsWith("/") ? appUrl : `${appUrl}/`;

  return new URL(routePath, baseUrl).toString();
}

async function getSlopEvidence(page: Page, pagePath: string): Promise<SlopEvidence> {
  const elements = await page.evaluate(() => {
    const selectorFor = (element: HTMLElement) => {
      const id = element.id === "" ? "" : `#${element.id}`;
      const classes = [...element.classList].map((name) => `.${name}`).join("");

      return `${element.tagName.toLowerCase()}${id}${classes}`;
    };

    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => !["script", "style", "noscript"].includes(element.tagName.toLowerCase()))
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);

        if (
          rect.width === 0 ||
          rect.height === 0 ||
          computed.display === "none" ||
          computed.visibility === "hidden"
        ) {
          return [];
        }

        const directText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .trim();
        const text = (element.textContent ?? "").trim().slice(0, 240);
        const attributes: Record<string, string> = {};

        for (const name of [
          "aria-label",
          "alt",
          "data-confirm",
          "data-state",
          "id",
          "onclick",
          "role",
          "src",
          "type",
        ]) {
          const value = element.getAttribute(name);

          if (value !== null) {
            attributes[name] = value;
          }
        }

        return [
          {
            attributes,
            children: [...element.children].map((child) => ({
              childCount: child.children.length,
              signature: selectorFor(child as HTMLElement),
              textLength: ((child as HTMLElement).textContent ?? "").trim().length,
            })),
            classes: [...element.classList],
            directText: directText.slice(0, 240),
            rect: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
            selector: selectorFor(element),
            styles: {
              backgroundColor: computed.backgroundColor,
              backgroundImage: computed.backgroundImage,
              borderRadius: computed.borderRadius,
              boxShadow: computed.boxShadow,
              display: computed.display,
              fontFamily: computed.fontFamily,
              fontSize: computed.fontSize,
              fontWeight: computed.fontWeight,
              textAlign: computed.textAlign,
            },
            tag: element.tagName.toLowerCase(),
            text,
          },
        ];
      });
  });

  return { elements, path: pagePath };
}

async function getAccessibilityTree(page: Page): Promise<{ nodes: unknown[] }> {
  const session = await page.context().newCDPSession(page);

  try {
    await session.send("Accessibility.enable");

    return await session.send("Accessibility.getFullAXTree");
  } finally {
    await session.detach();
  }
}

async function resolveSelection(
  scope: PageGroup | CaptureSelection,
  projectRoot: string,
): Promise<CaptureSelection> {
  if (typeof scope !== "string") {
    return {
      id: scope.id,
      name: scope.name,
      pages: [...new Set(scope.pages.map((page) => normalizePagePath(page)))],
    };
  }

  const config = await loadScopes(projectRoot);
  const savedScope = findScope(config, scope);

  if (savedScope === undefined) {
    throw new Error(`Unknown scope ${scope}.`);
  }

  return {
    id: savedScope.id,
    name: savedScope.name,
    pages: savedScope.routes,
  };
}

export async function capture(
  appUrl: string,
  scope: PageGroup | CaptureSelection,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const selection = await resolveSelection(scope, projectRoot);

  if (selection.pages.length === 0) {
    throw new Error(`The ${selection.name} scope has no pages to capture.`);
  }

  const summary: ScopeSummary = {
    id: selection.id,
    name: selection.name,
    pages: selection.pages,
    estimatedSeconds: Math.max(6, selection.pages.length * 6),
    message: formatCaptureSummary(selection.name, selection.pages),
  };

  await options.onScope?.(summary);

  const outputDir =
    options.outputDir ??
    path.resolve(process.cwd(), ".fittingroom", "captures", routeSlug(selection.id));

  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();

    try {
      const pages: CapturedPage[] = [];

      for (const pagePath of selection.pages) {
        const page = await context.newPage();
        const pageDirectory = path.join(outputDir, routeSlug(pagePath));

        await mkdir(pageDirectory, { recursive: true });
        const url = routeUrl(appUrl, pagePath);
        const screenshots: PageScreenshot[] = [];

        for (const width of CAPTURE_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(url, { waitUntil: "load" });

          const screenshotPath = path.join(pageDirectory, `${width}.png`);

          await page.screenshot({ fullPage: true, path: screenshotPath });
          screenshots.push({ width, path: screenshotPath });
        }

        const accessibilityTreePath = path.join(pageDirectory, "accessibility-tree.json");
        const accessibilityTree = await getAccessibilityTree(page);
        const slopEvidencePath = path.join(pageDirectory, "slop-evidence.json");
        const slopEvidence = await getSlopEvidence(page, pagePath);

        await writeFile(accessibilityTreePath, `${JSON.stringify(accessibilityTree, null, 2)}\n`);
        await writeFile(slopEvidencePath, `${JSON.stringify(slopEvidence, null, 2)}\n`);
        await page.close();

        pages.push({
          path: pagePath,
          url,
          screenshots,
          accessibilityTreePath,
          slopEvidencePath,
        });
      }

      return { summary, pages };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
