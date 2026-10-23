import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capture, type ScopeSummary } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

let server: FixtureServer;
let temporaryDirectory: string;

beforeAll(async () => {
  server = await startFixtureServer(fixturePath("bad-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-capture-"));
});

afterAll(async () => {
  await server.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("capture", () => {
  it("returns a scope summary before capturing only the selected pages", async () => {
    const outputDir = path.join(temporaryDirectory, "captures");
    let observedSummary: ScopeSummary | undefined;
    let outputExistedAtSummary = true;

    const result = await capture(server.origin, "auth", {
      projectRoot: fixturePath("bad-ui"),
      outputDir,
      onScope: (summary) => {
        observedSummary = summary;
        outputExistedAtSummary = existsSync(outputDir);
      },
    });

    expect(observedSummary).toBeDefined();
    expect(outputExistedAtSummary).toBe(false);
    expect(result.summary).toEqual(observedSummary);
    expect(result.summary.id).toBe("auth");
    expect(result.summary.name).toBe("Authentication");
    expect(result.summary.pages).toEqual(["/login", "/signup"]);
    expect(result.summary.estimatedSeconds).toBeGreaterThan(0);
    expect(result.summary.message).toBe(
      "Capturing: Authentication (2 pages): /login /signup, at 375, 768 and 1440 px.",
    );
    expect(result.pages.map((page) => page.path)).toEqual(["/login", "/signup"]);

    for (const page of result.pages) {
      expect(page.screenshots.map((screenshot) => screenshot.width)).toEqual([375, 768, 1440]);

      for (const screenshot of page.screenshots) {
        const screenshotFile = await stat(screenshot.path);

        expect(screenshotFile.size).toBeGreaterThan(0);
        expect(path.extname(screenshot.path)).toBe(".png");
      }

      const accessibilityTree = JSON.parse(await readFile(page.accessibilityTreePath, "utf8")) as {
        nodes?: unknown[];
      };

      expect(accessibilityTree.nodes?.length).toBeGreaterThan(0);
    }

    const pageRequests = new Set(
      server.requests.filter((request) => request !== "/favicon.ico" && request !== "/styles.css"),
    );

    expect(pageRequests).toEqual(new Set(["/login", "/signup"]));
  }, 120_000);

  it("captures only the four auth pages in the 14-route fixture", async () => {
    const scopeProject = fixturePath("scope-app");
    const scopeServer = await startFixtureServer(scopeProject);
    const outputDir = path.join(temporaryDirectory, "scope-app-captures");

    try {
      const result = await capture(scopeServer.origin, "auth", {
        projectRoot: scopeProject,
        outputDir,
      });
      const pages = ["/login", "/signup", "/forgot-password", "/verify"];

      expect(result.summary.id).toBe("auth");
      expect(result.summary.name).toBe("Authentication");
      expect(result.summary.pages).toEqual(pages);
      expect(result.summary.message).toBe(
        "Capturing: Authentication (4 pages): /login /signup /forgot-password /verify, at 375, 768 and 1440 px.",
      );
      expect(result.pages.map((page) => page.path)).toEqual(pages);
      expect(result.pages.flatMap((page) => page.screenshots)).toHaveLength(12);

      const pageRequests = new Set(
        scopeServer.requests.filter(
          (request) => request !== "/favicon.ico" && request !== "/styles.css",
        ),
      );

      expect(pageRequests).toEqual(new Set(pages));
    } finally {
      await scopeServer.close();
    }
  }, 120_000);
});
