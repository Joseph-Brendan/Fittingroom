import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Finding, findingIdForPage, mergeFindings, runAutomatedChecks } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const registryPath = fileURLToPath(new URL("../../citations/registry.json", import.meta.url));

let badServer: FixtureServer;
let goodServer: FixtureServer;
let temporaryDirectory: string;

beforeAll(async () => {
  badServer = await startFixtureServer(fixturePath("bad-ui"));
  goodServer = await startFixtureServer(fixturePath("good-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-audit-"));
});

afterAll(async () => {
  await badServer.close();
  await goodServer.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("runAutomatedChecks", () => {
  it("finds each planted measured bug exactly once on the right page", async () => {
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      citations: Array<{ id: string }>;
    };
    const citationIds = new Set(registry.citations.map((citation) => citation.id));
    const pagesWithBugs = [
      { citations: ["wcag22-1.4.3", "wcag22-2.4.11"], page: "/" },
      { citations: ["wcag22-1.1.1"], page: "/pricing" },
      { citations: ["wcag22-3.3.2"], page: "/signup" },
      { citations: ["wcag22-2.4.7"], page: "/onboarding" },
      { citations: ["wcag22-2.5.8"], page: "/reports" },
      { citations: ["wcag22-1.4.10"], page: "/checkout" },
    ];
    const allFindings: Array<{
      citation: string;
      page: string;
      related?: string[];
      selector: string;
      severity: number;
    }> = [];

    for (const entry of pagesWithBugs) {
      const slug = entry.page === "/" ? "root" : entry.page.replaceAll("/", "-");
      const { errors, findings } = await runAutomatedChecks(`${badServer.origin}${entry.page}`, {
        outputDir: path.join(temporaryDirectory, "bad-ui", slug),
      });

      expect(errors).toEqual([]);
      expect(findings.map((finding) => finding.citation).sort()).toEqual(
        [...entry.citations].sort(),
      );
      allFindings.push(
        ...findings.map((finding) => ({
          citation: finding.citation,
          page: entry.page,
          ...(finding.related === undefined ? {} : { related: finding.related }),
          selector: finding.evidence.selector,
          severity: finding.severity,
        })),
      );

      for (const finding of findings) {
        expect(citationIds.has(finding.citation)).toBe(true);
        expect(finding.evidence.selector.trim()).not.toBe("");
        expect(finding.evidence.measuredValue.trim()).not.toBe("");
        expect(finding.evidence.screenshotPath).toMatch(/\.png$/);

        const screenshot = await stat(finding.evidence.screenshotPath);

        expect(screenshot.size).toBeGreaterThan(0);
      }
    }

    for (const page of ["/analytics", "/dashboard", "/login", "/settings"]) {
      const { errors, findings } = await runAutomatedChecks(`${badServer.origin}${page}`, {
        outputDir: path.join(temporaryDirectory, "bad-ui", page.replaceAll("/", "-")),
      });

      expect(errors).toEqual([]);
      expect(findings).toEqual([]);
    }

    const plantedBugs = [
      { citation: "wcag22-1.4.3", page: "/", selector: "helper" },
      { citation: "wcag22-2.4.11", page: "/", selector: "focus-target" },
      { citation: "wcag22-1.1.1", page: "/pricing", selector: "img" },
      {
        citation: "wcag22-3.3.2",
        page: "/signup",
        related: ["wcag22-4.1.2"],
        selector: "email",
        severity: 4,
      },
      { citation: "wcag22-2.4.7", page: "/onboarding", selector: "no-focus" },
      { citation: "wcag22-2.5.8", page: "/reports", selector: "icon-save" },
      { citation: "wcag22-1.4.10", page: "/checkout", selector: "wide-panel" },
    ];

    expect(allFindings).toHaveLength(plantedBugs.length);

    for (const bug of plantedBugs) {
      const matches = allFindings.filter(
        (finding) =>
          finding.citation === bug.citation &&
          finding.page === bug.page &&
          finding.selector.includes(bug.selector),
      );

      expect(matches).toHaveLength(1);

      if ("related" in bug) {
        expect(matches[0]).toMatchObject({
          related: bug.related,
          severity: bug.severity,
        });
      }
    }
  }, 120_000);

  it("merges citations for one root problem and keeps the higher severity", () => {
    const merged = mergeFindings([
      {
        id: "label",
        title: "Form elements must have labels",
        citation: "wcag22-3.3.2",
        severity: 4,
        confidence: "measured",
        evidence: {
          selector: "#email",
          screenshotPath: "label.png",
          measuredValue: "No label",
        },
        fix: "Add a label.",
      },
      {
        id: "name",
        title: "Form field has no accessible name",
        citation: "wcag22-4.1.2",
        severity: 3,
        confidence: "measured",
        evidence: {
          selector: "#email",
          screenshotPath: "name.png",
          measuredValue: "No accessible name",
        },
        fix: "Add an accessible name.",
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      citation: "wcag22-3.3.2",
      related: ["wcag22-4.1.2"],
      severity: 4,
    });
  });

  it("gives findings with the same check id on different pages unique ids", () => {
    expect(findingIdForPage("/login", "target-size-1")).toBe("login-target-size-1");
    expect(findingIdForPage("/signup", "target-size-1")).toBe("signup-target-size-1");
    expect(findingIdForPage("/", "target-size-1")).toBe("root-target-size-1");
  });

  it("does not merge different problems on the same element", () => {
    const findings: Finding[] = [
      {
        id: "contrast",
        title: "Text has low contrast",
        citation: "wcag22-1.4.3",
        severity: 3,
        confidence: "measured",
        evidence: {
          selector: "#button",
          screenshotPath: "contrast.png",
          measuredValue: "2.1:1",
        },
        fix: "Increase contrast.",
      },
      {
        id: "target",
        title: "Target is too small",
        citation: "wcag22-2.5.8",
        severity: 2,
        confidence: "measured",
        evidence: {
          selector: "#button",
          screenshotPath: "target.png",
          measuredValue: "18 x 18",
        },
        fix: "Make the target larger.",
      },
    ];

    const merged = mergeFindings(findings);

    expect(merged).toHaveLength(2);
    expect(merged.map((finding) => finding.citation)).toEqual(["wcag22-1.4.3", "wcag22-2.5.8"]);
  });

  it("turns unmeasurable contrast into judged findings instead of crashing", async () => {
    const { errors, findings } = await runAutomatedChecks(`${badServer.origin}/contrast-cases`, {
      outputDir: path.join(temporaryDirectory, "contrast-cases"),
    });
    const contrastFindings = findings.filter((finding) => finding.citation === "wcag22-1.4.3");

    expect(errors).toEqual([]);
    expect(contrastFindings).toHaveLength(5);

    for (const selector of [
      "#gradient",
      "#image-bg",
      "#transparent-text",
      "#canvas-text",
      "#svg-text",
    ]) {
      const finding = contrastFindings.find((entry) => entry.evidence.selector === selector);

      expect(finding).toMatchObject({
        citation: "wcag22-1.4.3",
        confidence: "judged",
        severity: 2,
        title: "Contrast could not be measured, check by eye",
      });
      expect(finding?.evidence.measuredValue).toContain("Contrast could not be measured");
      expect(finding?.evidence.screenshotPath).toMatch(/\.png$/);

      if (finding === undefined) {
        throw new Error(`Missing contrast finding for ${selector}.`);
      }

      const screenshot = await stat(finding.evidence.screenshotPath);

      expect(screenshot.size).toBeGreaterThan(0);
    }
  }, 120_000);

  it("does not crash when an axe result has null data", async () => {
    const { errors, findings } = await runAutomatedChecks(`${badServer.origin}/null-data`, {
      outputDir: path.join(temporaryDirectory, "null-data"),
    });
    const titleFinding = findings.find((finding) => finding.citation === "wcag22-2.4.2");

    expect(errors).toEqual([]);
    expect(titleFinding).toMatchObject({
      confidence: "measured",
      evidence: { selector: "html" },
    });
  }, 120_000);

  it("keeps auditing after an axe element has no citation", async () => {
    const { errors, findings } = await runAutomatedChecks(`${badServer.origin}/check-error`, {
      outputDir: path.join(temporaryDirectory, "check-error"),
    });
    const citations = findings.map((finding) => finding.citation);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      check: "axe:summary-name",
      selector: "summary",
    });
    expect(errors[0]?.message).toContain("No citation registered for axe rule summary-name.");
    expect(citations).toContain("wcag22-1.4.3");
    expect(citations).toContain("wcag22-2.5.8");
    expect(citations).toContain("wcag22-1.4.10");
  }, 120_000);

  it("returns no findings on any good-ui page", async () => {
    const pages = [
      "/",
      "/analytics",
      "/checkout",
      "/dashboard",
      "/login",
      "/onboarding",
      "/pricing",
      "/reports",
      "/settings",
      "/signup",
    ];

    for (const page of pages) {
      const { errors, findings } = await runAutomatedChecks(`${goodServer.origin}${page}`, {
        outputDir: path.join(temporaryDirectory, "good-ui", page.replaceAll("/", "-")),
      });

      expect(errors).toEqual([]);
      expect(findings).toEqual([]);
    }
  }, 120_000);
});
