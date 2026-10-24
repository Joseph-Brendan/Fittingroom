import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkState, checkStates, type StateName } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

let server: FixtureServer;
let temporaryDirectory: string;

beforeAll(async () => {
  server = await startFixtureServer(fixturePath("bad-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-states-"));
});

afterAll(async () => {
  await server.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

async function stateCheck(route: string, state: StateName) {
  return checkState({
    baseUrl: server.origin,
    outputDir: path.join(temporaryDirectory, "states"),
    projectRoot: temporaryDirectory,
    route,
    state,
  });
}

describe("states check", () => {
  it("passes a useful empty state", async () => {
    const result = await stateCheck("/state-empty-good.html", "empty");

    expect(result.status).toBe("pass");
    expect(result.citation).toBeUndefined();
  });

  it("fails an empty state with no next step", async () => {
    const result = await stateCheck("/state-empty-bad.html", "empty");

    expect(result.status).toBe("fail");
    expect(result.citation).toBe("nielsen-h1");
    expect(result.related).toEqual(["nielsen-h10"]);
  });

  it("passes a visible loading state", async () => {
    const result = await stateCheck("/state-loading-good.html", "loading");

    expect(result.status).toBe("pass");
  });

  it("fails a loading state with no indicator", async () => {
    const result = await stateCheck("/state-loading-bad.html", "loading");

    expect(result.status).toBe("fail");
    expect(result.citation).toBe("nielsen-h1");
  });

  it("passes an error state with recovery", async () => {
    const result = await stateCheck("/state-error-good.html", "error");

    expect(result.status).toBe("pass");
  });

  it("fails an error state with no recovery", async () => {
    const result = await stateCheck("/state-error-bad.html", "error");

    expect(result.status).toBe("fail");
    expect(result.citation).toBe("nielsen-h9");
  });

  it("passes long text without overflow at 320 pixels", async () => {
    const result = await stateCheck("/state-long-good.html", "long");

    expect(result.status).toBe("pass");
  });

  it("fails long text that overflows at 320 pixels", async () => {
    const result = await stateCheck("/state-long-bad.html", "long");

    expect(result.status).toBe("fail");
    expect(result.citation).toBe("wcag22-1.4.10");
    expect(result.related).toEqual(["wcag22-1.4.12"]);
  });

  it("passes contrast in dark mode", async () => {
    const result = await stateCheck("/state-dark-good.html", "dark");

    expect(result.status).toBe("pass");
  });

  it("fails contrast in dark mode", async () => {
    const result = await stateCheck("/state-dark-bad.html", "dark");

    expect(result.status).toBe("fail");
    expect(result.citation).toBe("wcag22-1.4.3");
    expect(result.related).toEqual(["wcag22-1.4.11"]);
  });

  it("marks empty, loading and error not reachable on a page with no API calls", async () => {
    const empty = await stateCheck("/state-no-api.html", "empty");
    const loading = await stateCheck("/state-no-api.html", "loading");
    const error = await stateCheck("/state-no-api.html", "error");

    expect(empty.status).toBe("not_reachable");
    expect(loading.status).toBe("not_reachable");
    expect(error.status).toBe("not_reachable");
    expect(empty.reason).toContain("no same-origin API calls");
  });

  it("writes a report with all five states", async () => {
    const report = await checkStates({
      baseUrl: server.origin,
      outputDir: path.join(temporaryDirectory, "all-states"),
      projectRoot: temporaryDirectory,
      route: "/state-empty-good.html",
    });

    expect(report.states.map((state) => state.state)).toEqual([
      "empty",
      "loading",
      "error",
      "long",
      "dark",
    ]);
  });
});
