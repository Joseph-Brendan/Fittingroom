import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditDesignMemory,
  type DesignMemory,
  readDesignMemory,
  saveDesignMemory,
} from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const memory: DesignMemory = {
  version: 1,
  direction: {
    slug: "clean-ui",
    name: "Clean UI",
    description: "Calm neutrals, precise spacing and clear interaction states.",
  },
  type: {
    pair: ["Inter", "system-ui", "sans-serif"],
    scale: [16, 24, 32],
  },
  colors: {
    accent: "#1d4ed8",
    accentText: "#ffffff",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#111827",
  },
  spacing: {
    lg: "24px",
    md: "16px",
    sm: "8px",
  },
  radii: {
    control: "6px",
    panel: "12px",
  },
  density: "balanced",
  button: {
    backgroundColor: "#1d4ed8",
    borderRadius: "6px",
    color: "#ffffff",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "16px",
    fontWeight: "600",
    padding: "12px 18px",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#111827",
    borderRadius: "6px",
    color: "#111827",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "16px",
    padding: "8px 12px",
  },
  do: ["Keep one primary action per screen.", "Use the saved spacing scale."],
  dont: ["Do not introduce colors outside the saved tokens."],
};

let server: FixtureServer;
let temporaryDirectory: string;

beforeAll(async () => {
  server = await startFixtureServer(fixturePath("design-memory"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-memory-"));
});

afterAll(async () => {
  await server.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

async function audit(page: string): Promise<Awaited<ReturnType<typeof auditDesignMemory>>> {
  return auditDesignMemory({
    outputDir: path.join(temporaryDirectory, "audits", page),
    projectRoot: temporaryDirectory,
    url: `${server.origin}/${page}`,
  });
}

describe("design memory", () => {
  it("writes the human and machine files", async () => {
    const result = await saveDesignMemory(temporaryDirectory, memory);
    const design = await readFile(
      path.join(temporaryDirectory, ".fittingroom", "DESIGN.md"),
      "utf8",
    );
    const saved = await readDesignMemory(temporaryDirectory);

    expect(result.files).toContain(".fittingroom/DESIGN.md");
    expect(design).toContain("# Clean UI");
    expect(design).toContain("Inter");
    expect(design).toContain("#1d4ed8");
    expect(saved?.button.backgroundColor).toBe("#1d4ed8");
    expect(
      (await stat(path.join(temporaryDirectory, ".fittingroom", "design-memory.json"))).size,
    ).toBeGreaterThan(0);
  });

  it("keeps the old design memory when a new design is approved", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    await saveDesignMemory(temporaryDirectory, {
      ...memory,
      direction: { ...memory.direction, name: "Clean UI v2" },
    });

    const files = await readFile(
      path.join(temporaryDirectory, ".fittingroom", "design-memory.json"),
      "utf8",
    );
    const directory = await readdir(path.join(temporaryDirectory, ".fittingroom"));

    expect(files).toContain("Clean UI v2");
    expect(
      (await readFile(path.join(temporaryDirectory, ".fittingroom", "DESIGN.md"), "utf8")).length,
    ).toBeGreaterThan(0);
    expect(directory.some((file) => /^DESIGN\.\d{4}-\d{2}-\d{2}.*\.md$/.test(file))).toBe(true);
  });

  it("gives no findings on a page that follows the memory", async () => {
    await saveDesignMemory(temporaryDirectory, memory);

    expect(await audit("good.html")).toEqual([]);
  });

  it("finds a color break exactly once with both citations", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    const findings = await audit("break-color.html");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      citation: "project-design-memory",
      confidence: "measured",
      related: ["nielsen-h4"],
      severity: 2,
    });
  });

  it("finds a font family break exactly once", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    const findings = await audit("break-font.html");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ citation: "project-design-memory", severity: 2 });
  });

  it("finds a font size break exactly once", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    const findings = await audit("break-size.html");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ citation: "project-design-memory", severity: 2 });
  });

  it("finds a spacing break exactly once", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    const findings = await audit("break-spacing.html");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ citation: "project-design-memory", severity: 1 });
  });

  it("finds a radius break exactly once", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    const findings = await audit("break-radius.html");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ citation: "project-design-memory", severity: 1 });
  });

  it("finds a primary button break once with severity 3", async () => {
    await saveDesignMemory(temporaryDirectory, memory);
    const findings = await audit("break-button.html");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      citation: "project-design-memory",
      related: ["nielsen-h4"],
      severity: 3,
    });
  });
});
