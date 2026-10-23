import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyEdit, type DesignTokens, type EditOperation, undoEdit } from "../src/index";

const fixtureRoot = fileURLToPath(new URL("./fixtures/edit-engine/", import.meta.url));
const tokens: DesignTokens = {
  color: { brand: "#1d4ed8", text: "#111827" },
  space: { sm: "8px", lg: "24px" },
  radius: { card: "12px" },
  font: { sans: "Inter, system-ui, sans-serif" },
  fontSize: { sm: "14px" },
  shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
};
const operationCases: Array<{ name: string; operation: EditOperation }> = [
  {
    name: "set-token",
    operation: { op: "set-token", id: "title", property: "color", token: "color.brand" },
  },
  {
    name: "set-text",
    operation: { op: "set-text", id: "title", text: "New title" },
  },
  {
    name: "move",
    operation: { op: "move", id: "feature-b", parent: "features", index: 0 },
  },
  {
    name: "delete",
    operation: { op: "delete", id: "body" },
  },
  {
    name: "duplicate",
    operation: { op: "duplicate", id: "title", newId: "title-copy" },
  },
  {
    name: "insert",
    operation: {
      op: "insert",
      parent: "features",
      index: 1,
      component: "button",
      id: "save",
      text: "Save",
    },
  },
  {
    name: "swap-section",
    operation: { op: "swap-section", firstId: "hero", secondId: "features" },
  },
];

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitting-room-edits-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe.each(operationCases)("edit engine: $name", ({ name, operation }) => {
  it(`applies ${name} and writes a clean TSX file`, async () => {
    const projectRoot = path.join(temporaryDirectory, name);
    const filePath = path.join(projectRoot, "variant.tsx");
    const beforePath = path.join(fixtureRoot, name, "before.tsx");
    const afterPath = path.join(fixtureRoot, name, "after.tsx");

    await cp(beforePath, filePath);

    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = await applyEdit(filePath, operation, {
      projectRoot,
      tokens,
      now: () => now,
    });
    const expected = await readFile(afterPath, "utf8");
    const edited = await readFile(filePath, "utf8");

    expect(edited).toBe(expected);
    expect(result.offSystem).toBe(false);

    const log = JSON.parse(
      await readFile(path.join(projectRoot, ".fittingroom", "edits.json"), "utf8"),
    ) as {
      files: Record<
        string,
        { edits: Array<{ operation: EditOperation; timestamp: string; offSystem: boolean }> }
      >;
    };
    const key = path.relative(projectRoot, filePath).split(path.sep).join("/");
    const entry = log.files[key]?.edits[0];

    expect(entry?.operation).toEqual(operation);
    expect(entry?.timestamp).toBe(now.toISOString());
    expect(entry?.offSystem).toBe(false);
  });
});

describe("edit engine logging and undo", () => {
  it("flags off-system values while applying them", async () => {
    const projectRoot = path.join(temporaryDirectory, "off-system");
    const filePath = path.join(projectRoot, "variant.tsx");

    await cp(path.join(fixtureRoot, "set-token", "before.tsx"), filePath);

    const result = await applyEdit(
      filePath,
      { op: "set-token", id: "title", property: "color", token: "#ff00ff" },
      { projectRoot, tokens },
    );
    const edited = await readFile(filePath, "utf8");
    const log = JSON.parse(
      await readFile(path.join(projectRoot, ".fittingroom", "edits.json"), "utf8"),
    ) as {
      files: Record<string, { edits: Array<{ offSystem: boolean }> }>;
    };

    expect(edited).toContain('style={{ color: "#ff00ff" }}');
    expect(result.offSystem).toBe(true);
    expect(Object.values(log.files)[0]?.edits[0]?.offSystem).toBe(true);
  });

  it("replays the log without the last operation when undoing", async () => {
    const projectRoot = path.join(temporaryDirectory, "undo");
    const filePath = path.join(projectRoot, "variant.tsx");

    await cp(path.join(fixtureRoot, "set-text", "before.tsx"), filePath);

    await applyEdit(
      filePath,
      { op: "set-text", id: "title", text: "New title" },
      { projectRoot, tokens },
    );
    await applyEdit(
      filePath,
      { op: "set-token", id: "title", property: "color", token: "color.brand" },
      { projectRoot, tokens },
    );
    await undoEdit(filePath, { projectRoot, tokens });

    const edited = await readFile(filePath, "utf8");
    const expected = await readFile(path.join(fixtureRoot, "set-text", "after.tsx"), "utf8");
    const log = JSON.parse(
      await readFile(path.join(projectRoot, ".fittingroom", "edits.json"), "utf8"),
    ) as {
      files: Record<string, { edits: unknown[] }>;
    };

    expect(edited).toBe(expected);
    expect(Object.values(log.files)[0]?.edits).toHaveLength(1);
  });
});
