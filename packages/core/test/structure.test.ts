import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyStructureAction,
  extractStructure,
  readStructure,
  stampVariantFile,
} from "../src/index";

const temporaryDirectories: string[] = [];
const source = `
export default function Variant() {
  return (
    <main data-fr-id="page">
      <nav data-fr-id="nav"><a href="/">Home</a></nav>
      <section data-fr-id="hero">
        <h1 data-fr-id="hero-title">Plan work without the noise</h1>
        <p data-fr-id="hero-copy">Keep the important parts close.</p>
      </section>
      <section data-fr-id="features">
        <h2 data-fr-id="features-title">Everything you need</h2>
        <p data-fr-id="features-copy">A short feature list.</p>
      </section>
      <footer data-fr-id="footer">Built for small teams.</footer>
    </main>
  );
}
`;

async function projectWithVariant(
  variantSource = source,
): Promise<{ filePath: string; projectRoot: string }> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "fitroom-structure-"));
  temporaryDirectories.push(projectRoot);
  const filePath = path.join(projectRoot, "variants", "refined.tsx");

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, variantSource);
  await stampVariantFile(filePath);

  return { filePath, projectRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("information design", () => {
  it("finds the top-level blocks with kinds and order", async () => {
    const { filePath } = await projectWithVariant();
    const structure = await extractStructure({
      filePath,
      page: "/",
      scope: "marketing",
    });

    expect(structure.blocks.map((block) => block.id)).toEqual([
      "nav",
      "hero",
      "features",
      "footer",
    ]);
    expect(structure.blocks.map((block) => block.kind)).toEqual([
      "nav",
      "hero",
      "features",
      "footer",
    ]);
    expect(structure.blocks.map((block) => block.order)).toEqual([1, 2, 3, 4]);
    expect(structure.blocks.every((block) => block.visible)).toBe(true);
  });

  it("finds blocks inside a fragment with a style tag", async () => {
    const { filePath } = await projectWithVariant(`
      export default function Variant() {
        return (
          <>
            <style>{"body { margin: 0; }"}</style>
            <main data-fr-id="page">
              <section data-fr-id="hero"><h1 data-fr-id="title">Welcome back</h1></section>
              <form data-fr-id="form"><button data-fr-id="save" type="button">Log in</button></form>
            </main>
          </>
        );
      }
    `);
    const structure = await extractStructure({
      filePath,
      page: "/login",
      scope: "auth",
    });

    expect(structure.blocks.map((block) => block.id)).toEqual(["hero", "form"]);
    expect(structure.blocks.map((block) => block.kind)).toEqual(["hero", "form"]);
  });

  it("reorders blocks and saves the new order", async () => {
    const { filePath, projectRoot } = await projectWithVariant();
    const result = await applyStructureAction({
      action: { action: "reorder", id: "footer", index: 0 },
      filePath,
      page: "/",
      projectRoot,
      scope: "marketing",
      slug: "refined",
    });

    expect(result.source.indexOf('data-fr-id="footer"')).toBeLessThan(
      result.source.indexOf('data-fr-id="nav"'),
    );
    expect(result.structure.blocks.map((block) => block.id)).toEqual([
      "footer",
      "nav",
      "hero",
      "features",
    ]);
    expect((await readStructure(projectRoot))?.blocks[0]?.id).toBe("footer");
  });

  it("hides a block and marks it invisible", async () => {
    const { filePath, projectRoot } = await projectWithVariant();
    const result = await applyStructureAction({
      action: { action: "hide", id: "features" },
      filePath,
      page: "/",
      projectRoot,
      scope: "marketing",
      slug: "refined",
    });

    expect(result.source).not.toContain('data-fr-id="features"');
    expect(result.structure.blocks.find((block) => block.id === "features")?.visible).toBe(false);
  });

  it("promotes a block to the top and applies hero styles", async () => {
    const { filePath, projectRoot } = await projectWithVariant();
    const result = await applyStructureAction({
      action: { action: "promote", id: "features" },
      filePath,
      page: "/",
      projectRoot,
      scope: "marketing",
      slug: "refined",
    });

    expect(result.source.indexOf('data-fr-id="features"')).toBeLessThan(
      result.source.indexOf('data-fr-id="nav"'),
    );
    expect(result.source).toContain("fontSize");
    expect(result.source).toContain("48px");
    expect(result.structure.blocks.find((block) => block.id === "features")?.priority).toBe("hero");
  });

  it("groups two blocks in a shared container", async () => {
    const { filePath, projectRoot } = await projectWithVariant();
    const result = await applyStructureAction({
      action: { action: "group", firstId: "hero", secondId: "features" },
      filePath,
      page: "/",
      projectRoot,
      scope: "marketing",
      slug: "refined",
    });

    expect(result.source).toContain('data-fr-id="group-1"');
    expect(result.structure.blocks.find((block) => block.id === "hero")?.group).toBe("group-1");
    expect(result.structure.blocks.find((block) => block.id === "features")?.group).toBe("group-1");
  });

  it("wraps a block in an accessible disclosure", async () => {
    const { filePath, projectRoot } = await projectWithVariant();
    const result = await applyStructureAction({
      action: { action: "collapse", id: "features", mode: "accordion" },
      filePath,
      page: "/",
      projectRoot,
      scope: "marketing",
      slug: "refined",
    });

    expect(result.source).toContain('aria-expanded="false"');
    expect(result.source).toContain('aria-controls="features-panel"');
    expect(result.structure.blocks.find((block) => block.id === "features")?.collapse).toBe(
      "accordion",
    );
  });

  it("changes density and the spacing scale", async () => {
    const { filePath, projectRoot } = await projectWithVariant();
    const result = await applyStructureAction({
      action: { action: "density", density: "sparse" },
      filePath,
      page: "/",
      projectRoot,
      scope: "marketing",
      slug: "refined",
    });

    expect(result.source).toContain("48px");
    expect(result.structure.density).toBe("sparse");
  });
});
