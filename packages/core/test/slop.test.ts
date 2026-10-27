import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  capture,
  detectSlop,
  renderSlopScoreCard,
  type SlopReport,
  type SlopRuleResult,
  slopScoreCardHtml,
} from "../src/index";
import { fixturePath, startFixtureServer } from "./helpers/fixture-server";

interface RuleCase {
  fixture: string;
  id: string;
  weight: number;
}

const ruleCases: RuleCase[] = [
  { fixture: "gradient-hero", id: "gradient-hero", weight: 20 },
  { fixture: "identical-cards", id: "identical-cards", weight: 12 },
  { fixture: "emoji-icons", id: "emoji-icons", weight: 10 },
  { fixture: "centered-sections", id: "centered-sections", weight: 12 },
  { fixture: "single-font-weight", id: "single-font-weight", weight: 8 },
  { fixture: "button-effects", id: "button-effects", weight: 10 },
  { fixture: "generic-headlines", id: "generic-headlines", weight: 14 },
  { fixture: "stock-blobs", id: "stock-blobs", weight: 12 },
];

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-slop-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

async function detectFixture(fixture: string) {
  const fixtureRoot = fixturePath(`slop/${fixture}`);
  const server = await startFixtureServer(fixtureRoot);

  try {
    const captures = await capture(
      server.origin,
      { id: "slop", name: "Slop fixture", pages: ["/"] },
      {
        outputDir: path.join(temporaryDirectory, fixture),
        projectRoot: fixtureRoot,
      },
    );

    return await detectSlop(captures);
  } finally {
    await server.close();
  }
}

describe("detectSlop", () => {
  it("returns zero for a clean page", async () => {
    const report = await detectFixture("neutral");

    expect(report.score).toBe(0);
    expect(report.rules).toEqual([]);
    expect(report.topRules).toEqual([]);
  }, 120_000);

  for (const ruleCase of ruleCases) {
    it(`detects ${ruleCase.id} alone with evidence`, async () => {
      const report = await detectFixture(ruleCase.fixture);

      expect(report.rules.map((rule) => rule.id)).toEqual([ruleCase.id]);
      expect(report.score).toBe(ruleCase.weight);
      expect(report.rules[0]?.evidence.length).toBeGreaterThan(0);
      expect(report.rules[0]?.evidence[0]).toContain("/");
    }, 120_000);
  }
});

describe("slop score card", () => {
  const rules: SlopRuleResult[] = [
    {
      id: "gradient-hero",
      title: "Purple to blue gradient hero",
      weight: 20,
      evidence: ["section.hero: linear-gradient(120deg, #8b5cf6, #2563eb)"],
    },
    {
      id: "generic-headlines",
      title: "Generic headline phrases",
      weight: 14,
      evidence: ["h1: Supercharge your workflow"],
    },
    {
      id: "identical-cards",
      title: "Three identical feature cards",
      weight: 12,
      evidence: ["div.cards: 3 matching article.feature-card children"],
    },
    {
      id: "stock-blobs",
      title: "Stock 3D blobs",
      weight: 12,
      evidence: ["div.blob-3d: 3D blob"],
    },
  ];
  const report: SlopReport = {
    rules,
    score: 58,
    topRules: rules.slice(0, 3),
  };

  it("puts the score, top three rules and the footer in the card markup", () => {
    const html = slopScoreCardHtml(report);

    expect(html).toContain("58");
    expect(html).toContain("Purple to blue gradient hero");
    expect(html).toContain("Generic headline phrases");
    expect(html).toContain("Three identical feature cards");
    expect(html).not.toContain("Stock 3D blobs");
    expect(html).toContain("Checked with Fitroom");
  });

  it("exports a 1200 by 630 PNG", async () => {
    const outputPath = path.join(temporaryDirectory, "score-card.png");

    await renderSlopScoreCard(report, outputPath);
    const png = PNG.sync.read(await readFile(outputPath));

    expect(png.width).toBe(1200);
    expect(png.height).toBe(630);
  }, 120_000);
});
