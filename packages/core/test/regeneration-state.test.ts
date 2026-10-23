import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRegenerationHistory } from "../src/index";

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-history-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("regeneration history file", () => {
  it("creates history.json with valid defaults when it is missing", async () => {
    const projectRoot = path.join(temporaryDirectory, "missing");
    const history = await readRegenerationHistory(projectRoot);
    const stored = JSON.parse(
      await readFile(path.join(projectRoot, ".fittingroom", "history.json"), "utf8"),
    ) as unknown;

    expect(history).toEqual({ version: 1, scopes: {} });
    expect(stored).toEqual(history);
  });

  it("does not overwrite an existing history.json", async () => {
    const projectRoot = path.join(temporaryDirectory, "existing");
    const existing = { version: 1, scopes: {} };

    await mkdir(path.join(projectRoot, ".fittingroom"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".fittingroom", "history.json"),
      `${JSON.stringify(existing, null, 2)}\n`,
    );

    expect(await readRegenerationHistory(projectRoot)).toEqual(existing);
  });

  it("gives a plain error for corrupt history.json", async () => {
    const projectRoot = path.join(temporaryDirectory, "corrupt");

    await mkdir(path.join(projectRoot, ".fittingroom"), { recursive: true });
    await writeFile(path.join(projectRoot, ".fittingroom", "history.json"), '{"version": 1, ');

    await expect(readRegenerationHistory(projectRoot)).rejects.toThrow(
      /history\.json.*not valid JSON.*Fix the file or delete it/,
    );
  });
});
