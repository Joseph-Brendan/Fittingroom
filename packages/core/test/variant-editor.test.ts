import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyVariantEdit,
  type DesignTokens,
  redoVariantEdit,
  stampVariantFile,
  undoVariantEdit,
} from "../src/index";

const temporaryDirectories: string[] = [];
const tokens: DesignTokens = {
  color: { brand: "#1d4ed8" },
  space: { sm: "8px" },
  radius: { card: "12px" },
  font: { sans: "Inter, system-ui, sans-serif" },
  fontSize: { sm: "14px" },
  shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
};

const source = `
export default function Variant() {
  return (
    <main>
      <h1>Start here</h1>
      <p>Keep the important parts close.</p>
      <button type="button">Continue</button>
    </main>
  );
}
`;

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fitroom-variant-"));
  temporaryDirectories.push(directory);

  return directory;
}

async function writeVariant(projectRoot: string, text = source): Promise<string> {
  const filePath = path.join(projectRoot, "variants", "refined.tsx");

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);

  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("variant stamping", () => {
  it("adds a stable data-fr-id to every JSX element and keeps existing ids", async () => {
    const projectRoot = await temporaryProject();
    const filePath = await writeVariant(
      projectRoot,
      `
export default function Variant() {
  return (
    <main data-fr-id="page">
      <h1>Start here</h1>
      <button type="button">Continue</button>
    </main>
  );
}
`,
    );

    await stampVariantFile(filePath);
    const stamped = await readFile(filePath, "utf8");

    expect(stamped).toContain('data-fr-id="page"');
    expect(stamped.match(/data-fr-id=/g)).toHaveLength(3);
    expect(stamped).toContain('data-fr-id="fr-h1-1"');
    expect(stamped).toContain('data-fr-id="fr-button-1"');

    const first = stamped;
    await stampVariantFile(filePath);

    expect(await readFile(filePath, "utf8")).toBe(first);
  });
});

describe("variant edit log", () => {
  it("saves an untouched copy and a per-variant log", async () => {
    const projectRoot = await temporaryProject();
    const filePath = await writeVariant(projectRoot);

    await stampVariantFile(filePath);
    const original = await readFile(filePath, "utf8");
    await applyVariantEdit(
      filePath,
      { op: "set-text", id: "fr-h1-1", text: "Welcome back" },
      { projectRoot, slug: "refined", tokens },
    );

    const orig = await readFile(
      path.join(projectRoot, ".fitroom", "variants", "refined.orig.tsx"),
      "utf8",
    );
    const log = JSON.parse(
      await readFile(path.join(projectRoot, ".fitroom", "edits", "refined.json"), "utf8"),
    ) as { edits: unknown[]; redo: unknown[]; slug: string };

    expect(orig).toBe(original);
    expect(log.slug).toBe("refined");
    expect(log.edits).toHaveLength(1);
    expect(log.redo).toEqual([]);
  });

  it("undoes then redoes to the exact same file", async () => {
    const projectRoot = await temporaryProject();
    const filePath = await writeVariant(projectRoot);

    await stampVariantFile(filePath);
    const original = await readFile(filePath, "utf8");
    await applyVariantEdit(
      filePath,
      { op: "set-text", id: "fr-h1-1", text: "Welcome back" },
      { projectRoot, slug: "refined", tokens },
    );
    const edited = await readFile(filePath, "utf8");

    await undoVariantEdit(filePath, { projectRoot, slug: "refined", tokens });
    expect(await readFile(filePath, "utf8")).toBe(original);

    await redoVariantEdit(filePath, { projectRoot, slug: "refined", tokens });
    expect(await readFile(filePath, "utf8")).toBe(edited);
  });

  it("clears the redo stack when a new edit starts", async () => {
    const projectRoot = await temporaryProject();
    const filePath = await writeVariant(projectRoot);

    await stampVariantFile(filePath);
    await applyVariantEdit(
      filePath,
      { op: "set-text", id: "fr-h1-1", text: "Welcome back" },
      { projectRoot, slug: "refined", tokens },
    );
    await undoVariantEdit(filePath, { projectRoot, slug: "refined", tokens });
    await applyVariantEdit(
      filePath,
      { op: "set-text", id: "fr-p-1", text: "A new line." },
      { projectRoot, slug: "refined", tokens },
    );

    const log = JSON.parse(
      await readFile(path.join(projectRoot, ".fitroom", "edits", "refined.json"), "utf8"),
    ) as { edits: unknown[]; redo: unknown[] };

    expect(log.edits).toHaveLength(1);
    expect(log.redo).toEqual([]);
  });
});
