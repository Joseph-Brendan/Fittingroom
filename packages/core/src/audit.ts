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
  related?: string[];
  severity: Severity;
  confidence: FindingConfidence;
  evidence: FindingEvidence;
  fix: string;
}

export interface AuditOptions {
  outputDir?: string;
}

export interface AuditCheckError {
  check: string;
  message: string;
  selector: string;
}

export interface AuditReport {
  errors: AuditCheckError[];
  findings: Finding[];
}

interface AxeCheckResult {
  data: unknown;
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
  incomplete: AxeViolation[];
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

interface FocusIndicatorIssue {
  selector: string;
}

interface ViewportCheckError {
  check: string;
  message: string;
  selector: string;
}

interface CustomIssues {
  errors: ViewportCheckError[];
  focus: FocusIssue[];
  focusIndicators: FocusIndicatorIssue[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeAxeTargetSelector(target: unknown): string {
  try {
    return axeTargetSelector(target);
  } catch {
    return "unknown";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown check error.";
}

function axeMeasuredValue(violation: AxeViolation, node: AxeNodeResult): string {
  const data = node.any[0]?.data;

  if (isRecord(data) && typeof data.contrastRatio === "number") {
    const expected =
      typeof data.expectedContrastRatio === "string" ? data.expectedContrastRatio : "4.5:1";

    return `contrast ratio ${data.contrastRatio}:1, required ${expected}`;
  }

  if (node.failureSummary !== undefined && node.failureSummary.trim() !== "") {
    return node.failureSummary.replace(/\s+/g, " ").trim();
  }

  return `${violation.help} (${violation.id})`;
}

const relatedCitationGroups: readonly (readonly string[])[] = [["wcag22-3.3.2", "wcag22-4.1.2"]];

function citationProblemKey(citation: string): string {
  const group = relatedCitationGroups.find((ids) => ids.includes(citation));

  return group?.[0] ?? citation;
}

export function mergeFindings(findings: readonly Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();

  for (const finding of findings) {
    const key = `${finding.evidence.selector}\u0000${citationProblemKey(finding.citation)}`;
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, [finding]);
      continue;
    }

    group.push(finding);
  }

  const merged: Finding[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      const finding = group[0];

      if (finding !== undefined) {
        merged.push(finding);
      }

      continue;
    }

    const citationGroup = relatedCitationGroups.find((ids) =>
      group.some((finding) => ids.includes(finding.citation)),
    );

    if (citationGroup === undefined) {
      merged.push(...group);
      continue;
    }

    const primary = group.find((finding) => finding.citation === citationGroup[0]) ?? group[0];

    if (primary === undefined) {
      continue;
    }

    const related = [
      ...new Set([...(primary.related ?? []), ...group.map((finding) => finding.citation)]),
    ].filter((citation) => citation !== primary.citation);
    let severity = primary.severity;

    for (const finding of group) {
      if (finding.severity > severity) {
        severity = finding.severity;
      }
    }

    merged.push({
      ...primary,
      severity,
      ...(related.length === 0 ? {} : { related }),
    });
  }

  return merged;
}

function axeFix(citation: string): string {
  switch (citation) {
    case "wcag22-1.4.3":
      return "Use a text color and background pair that meet the 4.5:1 contrast minimum.";
    case "wcag22-1.4.4":
      return "Keep browser zoom enabled and let text grow without clipping.";
    case "wcag22-3.3.2":
      return "Add a visible label or clear instructions to the field.";
    case "wcag22-4.1.2":
      return "Give the field a visible label or an accessible name.";
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

    const safeSelectorFor = (element: Element): string => {
      try {
        return selectorFor(element);
      } catch {
        return element.tagName.toLowerCase();
      }
    };

    const messageFor = (error: unknown): string => {
      return error instanceof Error ? error.message : "Unknown check error.";
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

    const focusStyle = (element: HTMLElement): string => {
      const style = window.getComputedStyle(element);

      return [
        "background-color",
        "border-top-color",
        "border-right-color",
        "border-bottom-color",
        "border-left-color",
        "box-shadow",
        "color",
        "outline-color",
        "outline-style",
        "outline-width",
        "text-decoration-line",
      ]
        .map((property) => `${property}:${style.getPropertyValue(property)}`)
        .join("|");
    };

    const errors: ViewportCheckError[] = [];
    const elements: HTMLElement[] = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector))) {
      try {
        if (isVisible(element)) {
          elements.push(element);
        }
      } catch (error) {
        errors.push({
          check: "visibility",
          selector: safeSelectorFor(element),
          message: messageFor(error),
        });
      }
    }

    const targetSizes: TargetSizeIssue[] = [];

    for (const element of elements) {
      try {
        const rect = element.getBoundingClientRect();

        if (rect.width < 24 || rect.height < 24) {
          targetSizes.push({
            selector: selectorFor(element),
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          });
        }
      } catch (error) {
        errors.push({
          check: "target-size",
          selector: safeSelectorFor(element),
          message: messageFor(error),
        });
      }
    }

    const focus: FocusIssue[] = [];
    const focusIndicators: FocusIndicatorIssue[] = [];
    const pointRatios = [
      [0.5, 0.5],
      [0.2, 0.2],
      [0.8, 0.2],
      [0.2, 0.8],
      [0.8, 0.8],
    ];

    for (const element of elements) {
      try {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }

        const beforeFocus = focusStyle(element);

        element.focus();

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });

        if (document.activeElement !== element) {
          continue;
        }

        if (element.matches(":focus-visible") && beforeFocus === focusStyle(element)) {
          focusIndicators.push({ selector: selectorFor(element) });
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

        element.blur();
      } catch (error) {
        errors.push({
          check: "focus",
          selector: safeSelectorFor(element),
          message: messageFor(error),
        });
      }
    }

    return { errors, focus, focusIndicators, targetSizes };
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

export function findingIdForPage(pagePath: string, findingId: string): string {
  const pageKey = (pagePath === "/" ? "root" : pagePath.replace(/^\/+|\/+$/g, ""))
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return `${pageKey === "" ? "root" : pageKey}-${findingId}`;
}

function defaultOutputDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return path.resolve(process.cwd(), ".fitroom", "audits", timestamp);
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
): Promise<AuditReport> {
  const outputDir = options.outputDir ?? defaultOutputDir();
  const errors: AuditCheckError[] = [];
  const findings: Finding[] = [];

  await mkdir(outputDir, { recursive: true });

  const recordError = (check: string, selector: string, error: unknown): void => {
    errors.push({ check, selector, message: errorMessage(error) });
  };

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    try {
      try {
        await page.goto(url, { waitUntil: "load" });
      } catch (error) {
        recordError("page-load", "document", error);
        return { errors, findings };
      }

      let axeResults: AxeResults | null = null;

      try {
        axeResults = await runAxe(page);
      } catch (error) {
        recordError("axe", "document", error);
      }

      if (axeResults !== null) {
        const measuredContrastSelectors = new Set<string>();

        for (const violation of axeResults.violations) {
          for (const node of violation.nodes) {
            const selector = safeAxeTargetSelector(node.target);

            try {
              const citation = axeRuleCitations[violation.id];

              if (citation === undefined) {
                throw new Error(`No citation registered for axe rule ${violation.id}.`);
              }

              if (citation === "wcag22-1.4.3") {
                measuredContrastSelectors.add(selector);
              }

              const citations = violation.id === "label" ? [citation, "wcag22-4.1.2"] : [citation];

              for (const findingCitation of citations) {
                const index = findings.length + 1;
                const screenshotPath = await saveCrop(
                  page,
                  selector,
                  outputDir,
                  index,
                  findingCitation,
                );
                const isNameFinding = findingCitation === "wcag22-4.1.2";

                findings.push({
                  id: isNameFinding ? `axe-label-name-${index}` : `axe-${violation.id}-${index}`,
                  title: isNameFinding ? "Form field has no accessible name" : violation.help,
                  citation: findingCitation,
                  severity: isNameFinding ? 3 : severityFromImpact(violation.impact),
                  confidence: "measured",
                  evidence: {
                    selector,
                    screenshotPath,
                    measuredValue: axeMeasuredValue(violation, node),
                  },
                  fix: axeFix(findingCitation),
                });
              }
            } catch (error) {
              recordError(`axe:${violation.id}`, selector, error);
            }
          }
        }

        for (const violation of axeResults.incomplete) {
          if (violation.id !== "color-contrast") {
            continue;
          }

          for (const node of violation.nodes) {
            const selector = safeAxeTargetSelector(node.target);

            if (measuredContrastSelectors.has(selector)) {
              continue;
            }

            try {
              const index = findings.length + 1;
              const screenshotPath = await saveCrop(
                page,
                selector,
                outputDir,
                index,
                "wcag22-1.4.3",
              );
              const message = node.any[0]?.message;
              const measuredValue =
                message === undefined || message.trim() === ""
                  ? "Contrast could not be measured."
                  : `Contrast could not be measured: ${message}`;

              findings.push({
                id: `contrast-unmeasured-${index}`,
                title: "Contrast could not be measured, check by eye",
                citation: "wcag22-1.4.3",
                severity: 2,
                confidence: "judged",
                evidence: {
                  selector,
                  screenshotPath,
                  measuredValue,
                },
                fix: "Check the text against its background by eye, then use colors that meet the 4.5:1 contrast minimum.",
              });
            } catch (error) {
              recordError("axe:color-contrast", selector, error);
            }
          }
        }
      }

      let viewportIssues: CustomIssues | null = null;

      try {
        viewportIssues = await runViewportChecks(page);
      } catch (error) {
        recordError("viewport", "document", error);
      }

      if (viewportIssues !== null) {
        errors.push(...viewportIssues.errors);

        for (const issue of viewportIssues.targetSizes) {
          try {
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
          } catch (error) {
            recordError("target-size", issue.selector, error);
          }
        }

        for (const issue of viewportIssues.focus) {
          try {
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
          } catch (error) {
            recordError("focus", issue.selector, error);
          }
        }

        for (const issue of viewportIssues.focusIndicators) {
          try {
            const citation = "wcag22-2.4.7";
            const index = findings.length + 1;
            const screenshotPath = await saveCrop(page, issue.selector, outputDir, index, citation);

            findings.push({
              id: `focus-visible-${index}`,
              title: "Focused control has no visible focus indicator",
              citation,
              severity: 3,
              confidence: "measured",
              evidence: {
                selector: issue.selector,
                screenshotPath,
                measuredValue:
                  "no visible change to outline, border, background or text when focused",
              },
              fix: "Add a visible focus style such as an outline, ring or border.",
            });
          } catch (error) {
            recordError("focus-visible", issue.selector, error);
          }
        }
      }

      try {
        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto(url, { waitUntil: "load" });

        const reflowIssue = await runReflowCheck(page);

        if (reflowIssue !== null) {
          try {
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
          } catch (error) {
            recordError("reflow", reflowIssue.selector, error);
          }
        }
      } catch (error) {
        recordError("reflow", "document", error);
      }

      return { errors, findings: mergeFindings(findings) };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
