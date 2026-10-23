import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAutomatedChecks } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const registryPath = fileURLToPath(new URL("../../citations/registry.json", import.meta.url));

let badServer: FixtureServer;
let goodServer: FixtureServer;
let temporaryDirectory: string;

beforeAll(async () => {
  badServer = await startFixtureServer(fixturePath("bad-ui"));
  goodServer = await startFixtureServer(fixturePath("good-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitting-room-audit-"));
});

afterAll(async () => {
  await badServer.close();
  await goodServer.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("runAutomatedChecks", () => {
  it("returns one finding for each planted bug with cited evidence", async () => {
    const findings = await runAutomatedChecks(badServer.origin, {
      outputDir: path.join(temporaryDirectory, "bad-ui"),
    });
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      citations: Array<{ id: string }>;
    };
    const citationIds = new Set(registry.citations.map((citation) => citation.id));
    const citations = findings.map((finding) => finding.citation).sort();

    expect(findings).toHaveLength(4);
    expect(citations).toEqual(["wcag22-1.4.10", "wcag22-1.4.3", "wcag22-2.4.11", "wcag22-2.5.8"]);

    for (const finding of findings) {
      expect(citationIds.has(finding.citation)).toBe(true);
      expect(finding.evidence.selector.trim()).not.toBe("");
      expect(finding.evidence.measuredValue.trim()).not.toBe("");
      expect(finding.evidence.screenshotPath).toMatch(/\.png$/);

      const screenshot = await stat(finding.evidence.screenshotPath);

      expect(screenshot.size).toBeGreaterThan(0);
    }

    const contrast = findings.find((finding) => finding.citation === "wcag22-1.4.3");
    const targetSize = findings.find((finding) => finding.citation === "wcag22-2.5.8");
    const focus = findings.find((finding) => finding.citation === "wcag22-2.4.11");
    const reflow = findings.find((finding) => finding.citation === "wcag22-1.4.10");

    expect(contrast?.evidence.selector).toContain("helper");
    expect(targetSize?.evidence.selector).toContain("icon-save");
    expect(focus?.evidence.selector).toContain("focus-target");
    expect(reflow?.evidence.selector).toContain("wide-panel");
  }, 120_000);

  it("returns no findings on good-ui", async () => {
    const findings = await runAutomatedChecks(goodServer.origin, {
      outputDir: path.join(temporaryDirectory, "good-ui"),
    });

    expect(findings).toEqual([]);
  }, 120_000);
});
