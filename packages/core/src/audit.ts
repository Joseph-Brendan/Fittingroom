import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Page } from "playwright";

export type Severity = 0 | 1 | 2 | 3 | 4;
export type FindingConfidence = "measured" | "judged";

export interface FindingEvidence {
  selector: string;
  screenshotPath: string;
  measuredValue: string;
}

export interface Finding {
  id: string;
  title: string;
  citation: string;
  severity: Severity;
  confidence: FindingConfidence;
  evidence: FindingEvidence;
  fix: string;
}

export interface AuditOptions {
  outputDir?: string;
}

interface AxeCheckResult {
  data: Record<string, unknown>;
  id: string;
  impact?: string | null;
  message: string;
}

interface AxeNodeResult {
  all: AxeCheckResult[];
  any: AxeCheckResult[];
  failureSummary?: string;
  html: string;
  none: AxeCheckResult[];
  target: unknown;
}

interface AxeViolation {
  description: string;
  help: string;
  helpUrl: string;
  id: string;
  impact?: string | null;
  nodes: AxeNodeResult[];
  tags: string[];
}

interface AxeResults {
  violations: AxeViolation[];
}

interface TargetSizeIssue {
  height: number;
  selector: string;
  width: number;
}

interface FocusIssue {
  coveredBy: string;
  samplePoints: number;
  selector: string;
  visiblePoints: number;
}

interface CustomIssues {
  focus: FocusIssue[];
  targetSizes: TargetSizeIssue[];
}

interface ReflowIssue {
  scrollWidth: number;
  selector: string;
  viewportWidth: number;
}

const axeRuleCitations: Record<string, string> = {
  "area-alt": "wcag22-1.1.1",
  "aria-allowed-attr": "wcag22-4.1.2",
  "aria-braille-equivalent": "wcag22-4.1.2",
  "aria-command-name": "wcag22-4.1.2",
  "aria-dialog-name": "wcag22-4.1.2",
  "aria-hidden-body": "wcag22-4.1.2",
  "aria-hidden-focus": "wcag22-4.1.2",
  "aria-input-field-name": "wcag22-4.1.2",
  "aria-meter-name": "wcag22-4.1.2",
  "aria-progressbar-name": "wcag22-4.1.2",
  "aria-required-attr": "wcag22-4.1.2",
  "aria-required-children": "wcag22-1.3.1",
  "aria-required-parent": "wcag22-1.3.1",
  "aria-roles": "wcag22-4.1.2",
  "aria-text": "wcag22-1.3.1",
  "aria-toggle-field-name": "wcag22-4.1.2",
  "aria-tooltip-name": "wcag22-4.1.2",
  "aria-treeitem-name": "wcag22-4.1.2",
  "aria-valid-attr-value": "wcag22-4.1.2",
  "audio-caption": "wcag22-1.2.2",
  "autocomplete-valid": "wcag22-1.3.5",
  "avoid-inline-spacing": "wcag22-1.4.12",
  "button-name": "wcag22-4.1.2",
  bypass: "wcag22-2.4.1",
  "color-contrast": "wcag22-1.4.3",
  "css-orientation-lock": "wcag22-1.3.4",
  "definition-list": "wcag22-1.3.1",
  dlitem: "wcag22-1.3.1",
  "document-title": "wcag22-2.4.2",
  "duplicate-id-aria": "wcag22-4.1.2",
  "empty-heading": "wcag22-1.3.1",
  "empty-table-header": "wcag22-1.3.1",
  "form-field-multiple-labels": "wcag22-3.3.2",
  "frame-focusable-content": "wcag22-2.1.1",
  "frame-title": "wcag22-4.1.2",
  "heading-order": "wcag22-1.3.1",
  "html-has-lang": "wcag22-3.1.1",
  "html-lang-valid": "wcag22-3.1.1",
  "image-alt": "wcag22-1.1.1",
  "input-button-name": "wcag22-4.1.2",
  "input-image-alt": "wcag22-1.1.1",
  label: "wcag22-3.3.2",
  "link-in-text-block": "wcag22-1.4.1",
  "link-name": "wcag22-2.4.4",
  list: "wcag22-1.3.1",
  listitem: "wcag22-1.3.1",
  "meta-refresh": "wcag22-2.2.1",
  "meta-viewport": "wcag22-1.4.4",
  "nested-interactive": "wcag22-4.1.2",
  "no-autoplay-audio": "wcag22-1.4.2",
  "object-alt": "wcag22-1.1.1",
  "p-as-heading": "wcag22-1.3.1",
  "role-img-alt": "wcag22-1.1.1",
  "scope-attr-valid": "wcag22-1.3.1",
  "scrollable-region-focusable": "wcag22-2.1.1",
  "select-name": "wcag22-4.1.2",
  "server-side-image-map": "wcag22-2.1.1",
  "svg-img-alt": "wcag22-1.1.1",
  "table-fake-caption": "wcag22-1.3.1",
  "td-has-header": "wcag22-1.3.1",
  "td-headers-attr": "wcag22-1.3.1",
  "th-has-data-cells": "wcag22-1.3.1",
  "valid-lang": "wcag22-3.1.2",
  "video-caption": "wcag22-1.2.2",
  "video-description": "wcag22-1.2.5",
};

const require = createRequire(import.meta.url);
const axeScriptPath = path.join(path.dirname(require.resolve("axe-core")), "axe.min.js");

function severityFromImpact(impact: string | null | undefined): Severity {
  switch (impact) {
    case "minor":
      return 1;
    case "moderate":
      return 2;
    case "serious":
      return 3;
    case "critical":
      return 4;
    default:
      return 2;
  }
}

function axeTargetSelector(target: unknown): string {
  if (!Array.isArray(target) || target.length === 0) {
    return "html";
  }

  const first = target[0];

  if (typeof first === "string") {
    return first;
  }

  if (Array.isArray(first)) {
    return first.filter((part): part is string => typeof part === "string").join(" ");
  }

  return "html";
}

function axeMeasuredValue(violation: AxeViolation, node: AxeNodeResult): string {
  const data = node.any[0]?.data;

  if (data !== undefined && typeof data.contrastRatio === "number") {
    const expected =
      typeof data.expectedContrastRatio === "string" ? data.expectedContrastRatio : "4.5:1";

    return `contrast ratio ${data.contrastRatio}:1, required ${expected}`;
  }

  if (node.failureSummary !== undefined && node.failureSummary.trim() !== "") {
    return node.failureSummary.replace(/\s+/g, " ").trim();
  }

  return `${violation.help} (${violation.id})`;
}

function axeFix(citation: string): string {
  switch (citation) {
    case "wcag22-1.4.3":
      return "Use a text color and background pair that meet the 4.5:1 contrast minimum.";
    case "wcag22-1.4.4":
      return "Keep browser zoom enabled and let text grow without clipping.";
    default:
      return "Update the flagged element so it meets the cited requirement.";
  }
}

async function runAxe(page: Page): Promise<AxeResults> {
  await page.addScriptTag({ path: axeScriptPath });

  return page.evaluate(async () => {
    const runner = (
      window as Window & {
        axe?: {
          run: (
            context: Document,
            options: {
              rules: Record<string, { enabled: boolean }>;
              runOnly: { type: "tag"; values: string[] };
            },
          ) => Promise<AxeResults>;
        };
      }
    ).axe;

    if (runner === undefined) {
      throw new Error("axe-core did not load.");
    }

    return runner.run(document, {
      rules: {
        "target-size": { enabled: false },
      },
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
  });
}

async function runViewportChecks(page: Page): Promise<CustomIssues> {
  return page.evaluate(async () => {
    const interactiveSelector = [
      "a[href]",
      "area[href]",
      "button",
      'input:not([type="hidden"])',
      "select",
      "textarea",
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const selectorFor = (element: Element): string => {
      if (element.id !== "") {
        return `#${CSS.escape(element.id)}`;
      }

      const tag = element.tagName.toLowerCase();
      const classes = Array.from(element.classList).filter((name) => name.trim() !== "");

      if (classes.length > 0) {
        return `${tag}.${classes.map((name) => CSS.escape(name)).join(".")}`;
      }

      return tag;
    };

    const isVisible = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0
      );
    };

    const elements = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter(
      isVisible,
    );
    const targetSizes: TargetSizeIssue[] = [];

    for (const element of elements) {
      const rect = element.getBoundingClientRect();

      if (rect.width < 24 || rect.height < 24) {
        targetSizes.push({
          selector: selectorFor(element),
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        });
      }
    }

    const focus: FocusIssue[] = [];
    const pointRatios = [
      [0.5, 0.5],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ];

    for (const element of elements) {
      element.focus();

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      if (document.activeElement !== element) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      let pointsInViewport = 0;
      let visiblePoints = 0;
      let coveredBy = "";

      for (const [xRatio, yRatio] of pointRatios) {
        if (xRatio === undefined || yRatio === undefined) {
          continue;
        }

        const x = rect.left + rect.width * xRatio;
        const y = rect.top + rect.height * yRatio;

        if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
          continue;
        }

        pointsInViewport += 1;
        const hit = document.elementFromPoint(x, y);

        if (hit !== null && (hit === element || element.contains(hit))) {
          visiblePoints += 1;
        } else if (hit !== null && coveredBy === "") {
          coveredBy = selectorFor(hit);
        }
      }

      if (pointsInViewport > 0 && visiblePoints === 0) {
        focus.push({
          selector: selectorFor(element),
          coveredBy,
          samplePoints: pointsInViewport,
          visiblePoints,
        });
      }
    }

    return { focus, targetSizes };
  });
}

async function runReflowCheck(page: Page): Promise<ReflowIssue | null> {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);

    if (scrollWidth <= viewportWidth + 1) {
      return null;
    }

    const selectorFor = (element: Element): string => {
      if (element.id !== "") {
        return `#${CSS.escape(element.id)}`;
      }

      const tag = element.tagName.toLowerCase();
      const classes = Array.from(element.classList).filter((name) => name.trim() !== "");

      if (classes.length > 0) {
        return `${tag}.${classes.map((name) => CSS.escape(name)).join(".")}`;
      }

      return tag;
    };

    const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.right > viewportWidth + 1 &&
          style.position !== "fixed" &&
          style.visibility !== "hidden"
        );
      })
      .sort((first, second) => {
        return second.getBoundingClientRect().right - first.getBoundingClientRect().right;
      });
    const offender = offenders[0];

    return {
      viewportWidth,
      scrollWidth,
      selector: offender === undefined ? "html" : selectorFor(offender),
    };
  });
}

function defaultOutputDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return path.resolve(process.cwd(), ".fittingroom", "audits", timestamp);
}

async function saveCrop(
  page: Page,
  selector: string,
  outputDir: string,
  index: number,
  citation: string,
): Promise<string> {
  const name = `${String(index).padStart(2, "0")}-${citation.replace(/[^a-z0-9]+/gi, "-")}.png`;
  const screenshotPath = path.join(outputDir, name);

  try {
    const locator = page.locator(selector).first();

    await locator.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await locator.screenshot({ path: screenshotPath, timeout: 5_000 });
  } catch {
    await page.screenshot({ path: screenshotPath });
  }

  return screenshotPath;
}

export async function runAutomatedChecks(
  url: string,
  options: AuditOptions = {},
): Promise<Finding[]> {
  const outputDir = options.outputDir ?? defaultOutputDir();
  const findings: Finding[] = [];

  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "load" });

      const axeResults = await runAxe(page);

      for (const violation of axeResults.violations) {
        const citation = axeRuleCitations[violation.id];

        if (citation === undefined) {
          throw new Error(`No citation registered for axe rule ${violation.id}.`);
        }

        for (const node of violation.nodes) {
          const selector = axeTargetSelector(node.target);
          const index = findings.length + 1;
          const screenshotPath = await saveCrop(page, selector, outputDir, index, citation);

          findings.push({
            id: `axe-${violation.id}-${index}`,
            title: violation.help,
            citation,
            severity: severityFromImpact(violation.impact),
            confidence: "measured",
            evidence: {
              selector,
              screenshotPath,
              measuredValue: axeMeasuredValue(violation, node),
            },
            fix: axeFix(citation),
          });
        }
      }

      const viewportIssues = await runViewportChecks(page);

      for (const issue of viewportIssues.targetSizes) {
        const citation = "wcag22-2.5.8";
        const index = findings.length + 1;
        const screenshotPath = await saveCrop(page, issue.selector, outputDir, index, citation);

        findings.push({
          id: `target-size-${index}`,
          title: "Target is smaller than 24 by 24 CSS pixels",
          citation,
          severity: 2,
          confidence: "measured",
          evidence: {
            selector: issue.selector,
            screenshotPath,
            measuredValue: `${issue.width} x ${issue.height} CSS pixels (minimum 24 x 24)`,
          },
          fix: "Make the control at least 24 by 24 CSS pixels, or add enough spacing around it.",
        });
      }

      for (const issue of viewportIssues.focus) {
        const citation = "wcag22-2.4.11";
        const index = findings.length + 1;
        const screenshotPath = await saveCrop(page, issue.selector, outputDir, index, citation);
        const cover = issue.coveredBy === "" ? "page content" : issue.coveredBy;

        findings.push({
          id: `focus-obscured-${index}`,
          title: "Focused control is hidden by page content",
          citation,
          severity: 3,
          confidence: "measured",
          evidence: {
            selector: issue.selector,
            screenshotPath,
            measuredValue: `${issue.visiblePoints} of ${issue.samplePoints} sample points visible, covered by ${cover}`,
          },
          fix: "Move or resize the covering content so the focused control stays visible.",
        });
      }

      await page.setViewportSize({ width: 320, height: 900 });
      await page.goto(url, { waitUntil: "load" });

      const reflowIssue = await runReflowCheck(page);

      if (reflowIssue !== null) {
        const citation = "wcag22-1.4.10";
        const index = findings.length + 1;
        const screenshotPath = await saveCrop(
          page,
          reflowIssue.selector,
          outputDir,
          index,
          citation,
        );

        findings.push({
          id: `reflow-${index}`,
          title: "Page overflows at 320 CSS pixels",
          citation,
          severity: 2,
          confidence: "measured",
          evidence: {
            selector: reflowIssue.selector,
            screenshotPath,
            measuredValue: `document width ${reflowIssue.scrollWidth} CSS pixels at a ${reflowIssue.viewportWidth} CSS pixel viewport`,
          },
          fix: "Let the content wrap or shrink so the page fits a 320 CSS pixel viewport.",
        });
      }

      return findings;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
