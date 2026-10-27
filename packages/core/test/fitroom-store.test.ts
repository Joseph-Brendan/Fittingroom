import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadFitroomFile, writeJsonAtomic } from "../src/index";

interface SampleFile {
  value: string;
  version: 1;
}

function parseSample(value: unknown): SampleFile {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("value" in value) ||
    typeof value.value !== "string"
  ) {
    throw new Error("The sample file needs version 1 and a value string.");
  }

  return value as SampleFile;
}

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-store-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("Fitroom state files", () => {
  it("creates a missing file with valid defaults", async () => {
    const projectRoot = path.join(temporaryDirectory, "missing");
    const value = await loadFitroomFile({
      projectRoot,
      fileName: "sample.json",
      schema: parseSample,
      defaultValue: () => ({ version: 1, value: "default" }),
    });

    expect(value).toEqual({ version: 1, value: "default" });

    const filePath = path.join(projectRoot, ".fitroom", "sample.json");

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(value);
  });

  it("does not overwrite an existing file", async () => {
    const projectRoot = path.join(temporaryDirectory, "existing");
    const filePath = path.join(projectRoot, ".fitroom", "sample.json");

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ version: 1, value: "existing" })}\n`);

    const value = await loadFitroomFile({
      projectRoot,
      fileName: "sample.json",
      schema: parseSample,
      defaultValue: () => ({ version: 1, value: "default" }),
    });

    expect(value).toEqual({ version: 1, value: "existing" });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      value: "existing",
    });
  });

  it("names the file and the fix when JSON is corrupt", async () => {
    const projectRoot = path.join(temporaryDirectory, "corrupt");
    const filePath = path.join(projectRoot, ".fitroom", "sample.json");

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{"version": 1, "value": ');

    await expect(
      loadFitroomFile({
        projectRoot,
        fileName: "sample.json",
        schema: parseSample,
        defaultValue: () => ({ version: 1, value: "default" }),
      }),
    ).rejects.toThrow(/sample\.json.*not valid JSON.*Fix the file or delete it/);
  });

  it("names the file and the fix when the schema rejects the content", async () => {
    const projectRoot = path.join(temporaryDirectory, "invalid");
    const filePath = path.join(projectRoot, ".fitroom", "sample.json");

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ version: 2, value: "wrong" })}\n`);

    await expect(
      loadFitroomFile({
        projectRoot,
        fileName: "sample.json",
        schema: parseSample,
        defaultValue: () => ({ version: 1, value: "default" }),
      }),
    ).rejects.toThrow(/sample\.json.*needs version 1.*Fix the file or delete it/);
  });

  it("writes JSON atomically and leaves no temp files", async () => {
    const filePath = path.join(temporaryDirectory, "atomic", ".fitroom", "sample.json");

    await writeJsonAtomic(filePath, { version: 1, value: "one" });
    await writeJsonAtomic(filePath, { version: 1, value: "two" });

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      value: "two",
    });
    expect(await readdir(path.dirname(filePath))).toEqual(["sample.json"]);
  });

  it("keeps the old file when serialization fails", async () => {
    const filePath = path.join(temporaryDirectory, "serialize", ".fitroom", "sample.json");

    await writeJsonAtomic(filePath, { version: 1, value: "old" });

    await expect(
      writeJsonAtomic(filePath, {
        toJSON() {
          throw new Error("serialize failed");
        },
      }),
    ).rejects.toThrow("serialize failed");

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      value: "old",
    });
    expect(await readdir(path.dirname(filePath))).toEqual(["sample.json"]);
  });
});
