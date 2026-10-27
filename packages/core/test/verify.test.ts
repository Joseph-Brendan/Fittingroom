import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandoff, verifyImplementation } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

let server: FixtureServer;
let temporaryDirectory: string;
let handoffDir: string;
let handoffId: string;

beforeAll(async () => {
  server = await startFixtureServer(fixturePath("handoff"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-handoff-"));
  const handoff = await createHandoff({
    projectRoot: temporaryDirectory,
    referenceUrl: `${server.origin}/reference/index`,
    route: "/workspace",
    variantSlug: "slot-2-native",
    rationale: "Keep the familiar layout and tighten the hero.",
    tokens: {
      "color.action": "#1d4ed8",
      "color.panel": "#e0e7ff",
      "radius.panel": "16px",
      "space.panel": "40px",
      "type.title": "26px",
    },
  });

  handoffDir = handoff.folder;
  handoffId = handoff.handoffId;
});

afterAll(async () => {
  await server.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("handoff", () => {
  it("writes a brief that names the route, components, data wiring and verify step", async () => {
    const brief = await readFile(path.join(handoffDir, "brief.md"), "utf8");
    const manifest = JSON.parse(await readFile(path.join(handoffDir, "handoff.json"), "utf8")) as {
      route?: string;
      screenshots?: unknown[];
    };

    expect(handoffId).toMatch(/^[a-z0-9-]+$/);
    expect(manifest.route).toBe("/workspace");
    expect(manifest.screenshots).toHaveLength(3);
    expect(brief).toContain("Apply the design to the real /workspace route.");
    expect(brief).toContain("Reuse existing project components.");
    expect(brief).toContain("Keep all data wiring and real content.");
    expect(brief).toContain(`Call fr_verify with route /workspace and handoffId ${handoffId}.`);
  }, 120_000);

  it("ignores style elements in the handoff style map", async () => {
    const manifest = JSON.parse(await readFile(path.join(handoffDir, "handoff.json"), "utf8")) as {
      order: string[];
      styles: Record<string, Record<string, string>>;
    };

    expect(manifest.order).not.toContain("style-block");
    expect(manifest.styles["style-block"]).toBeUndefined();
  });

  it("writes tokens, structure, edits, fixed findings and the checklist", async () => {
    for (const fileName of [
      "tokens.json",
      "structure.json",
      "edits.json",
      "findings-fixed.json",
      "checklist.md",
    ]) {
      const file = await stat(path.join(handoffDir, fileName));

      expect(file.size).toBeGreaterThan(0);
    }

    const tokens = JSON.parse(await readFile(path.join(handoffDir, "tokens.json"), "utf8")) as {
      "color.action"?: string;
    };

    expect(tokens["color.action"]).toBe("#1d4ed8");
  }, 30_000);

  it("passes a correct implementation with no style or order mismatches", async () => {
    const report = await verifyImplementation({
      baseUrl: server.origin,
      route: "/correct/index",
      handoffDir,
      outputDir: path.join(temporaryDirectory, "verify-correct"),
    });

    expect(report.passed).toBe(true);
    expect(report.regionDiffs.every((region) => region.differencePercent < 2)).toBe(true);
    expect(report.tokenMismatches).toEqual([]);
    expect(report.orderMismatches).toEqual([]);
    expect(report.screenshots.map((screenshot) => screenshot.width)).toEqual([375, 768, 1440]);
  }, 120_000);

  it("passes when structure block order matches and fails when it does not", async () => {
    const structurePath = path.join(handoffDir, "structure.json");
    const originalStructure = await readFile(structurePath, "utf8");
    const blocks = [
      {
        id: "top",
        label: "Top",
        kind: "hero",
        order: 1,
        visible: true,
        priority: "hero",
        group: null,
        collapse: "none",
      },
      {
        id: "hero",
        label: "Hero",
        kind: "hero",
        order: 2,
        visible: true,
        priority: "normal",
        group: null,
        collapse: "none",
      },
      {
        id: "features",
        label: "Features",
        kind: "features",
        order: 3,
        visible: true,
        priority: "normal",
        group: null,
        collapse: "none",
      },
      {
        id: "footer",
        label: "Footer",
        kind: "footer",
        order: 4,
        visible: true,
        priority: "normal",
        group: null,
        collapse: "none",
      },
    ];

    await writeFile(
      structurePath,
      `${JSON.stringify({ scope: "marketing", page: "/workspace", density: "balanced", blocks }, null, 2)}\n`,
    );

    const pass = await verifyImplementation({
      baseUrl: server.origin,
      route: "/correct/index",
      handoffDir,
      outputDir: path.join(temporaryDirectory, "verify-structure-pass"),
    });

    expect(pass.structureMismatches).toEqual([]);
    expect(pass.passed).toBe(true);

    const wrong = [blocks[0], { ...blocks[2], order: 2 }, { ...blocks[1], order: 3 }, blocks[3]];

    await writeFile(
      structurePath,
      `${JSON.stringify({ scope: "marketing", page: "/workspace", density: "balanced", blocks: wrong }, null, 2)}\n`,
    );

    const fail = await verifyImplementation({
      baseUrl: server.origin,
      route: "/correct/index",
      handoffDir,
      outputDir: path.join(temporaryDirectory, "verify-structure-fail"),
    });

    expect(fail.structureMismatches.length).toBeGreaterThan(0);
    expect(fail.passed).toBe(false);
    await writeFile(structurePath, originalStructure);
  }, 120_000);

  it("does not fail on inherited border colors", async () => {
    const manifestPath = path.join(handoffDir, "handoff.json");
    const original = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(original) as {
      styles: Record<string, Record<string, string>>;
    };

    for (const style of Object.values(manifest.styles)) {
      style["border-top-color"] = "rgb(1, 2, 3)";
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    try {
      const report = await verifyImplementation({
        baseUrl: server.origin,
        route: "/correct/index",
        handoffDir,
        outputDir: path.join(temporaryDirectory, "verify-border-color"),
      });

      expect(
        report.styleMismatches.some((mismatch) => mismatch.property === "border-top-color"),
      ).toBe(false);
      expect(report.passed).toBe(true);
    } finally {
      await writeFile(manifestPath, original);
    }
  }, 120_000);

  it("fails a hand-made bad implementation on pixels, tokens and content order", async () => {
    const report = await verifyImplementation({
      baseUrl: server.origin,
      route: "/bad/index",
      handoffDir,
      outputDir: path.join(temporaryDirectory, "verify-bad"),
    });

    expect(report.passed).toBe(false);
    expect(report.regionDiffs.some((region) => region.differencePercent >= 2)).toBe(true);
    expect(report.tokenMismatches.length).toBeGreaterThan(0);
    expect(report.orderMismatches.length).toBeGreaterThan(0);
    expect(report.tokenMismatches.some((mismatch) => mismatch.id === "title")).toBe(true);
    expect(report.orderMismatches.some((mismatch) => mismatch.expected === "feature-capture")).toBe(
      true,
    );
  }, 120_000);
});
