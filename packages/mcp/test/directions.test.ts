import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFittingRoomServer } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

interface DirectionSlotPayload {
  slot: number;
  role: string;
  direction: {
    slug: string;
    name: string;
    surfaces: string[];
    modes?: string[];
  };
  screenshots: Array<{ width: number; path: string }>;
  contentInventory: Array<{ role: string; text: string }>;
  designSystem: {
    status: string;
    summary: string;
    sources: string[];
  };
  writingRules: string[];
}

interface DirectionsPayload {
  route: string;
  surface: string;
  slots: DirectionSlotPayload[];
}

interface RegisterPayload {
  accepted: boolean;
  errors?: string[];
  newFailures?: Array<{ citation: string }>;
  renderErrors?: string[];
  screenshotPath?: string;
  typecheck?: {
    passed: boolean;
    errors: string[];
  };
}

interface HandoffPayload {
  brief: string;
  folder: string;
  handoffId: string;
  route: string;
  screenshots: Array<{ path: string; width: number }>;
}

interface VerifyPayload {
  orderMismatches: unknown[];
  passed: boolean;
  regionDiffs: Array<{ differencePercent: number; passed: boolean }>;
  screenshots: Array<{ path: string; width: number }>;
  tokenMismatches: unknown[];
}

let fixture: FixtureServer;
let client: Client;
let server: ReturnType<typeof createFittingRoomServer>;
let temporaryDirectory: string;
let directions: DirectionsPayload;

const goodVariant = `
export default function GoodVariant() {
  return (
    <main style={{ boxSizing: "border-box", maxWidth: 420, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: "#16181d", background: "#ffffff" }}>
      <h1 style={{ margin: "0 0 16px", fontSize: "1.75rem" }}>Log in</h1>
      <label htmlFor="email" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Email</label>
      <input id="email" type="email" style={{ boxSizing: "border-box", width: "100%", minHeight: 44, marginBottom: 20, padding: "8px 12px", border: "1px solid #74777d", borderRadius: 6, font: "inherit" }} />
      <button type="button" style={{ minHeight: 44, padding: "12px 18px", border: 0, borderRadius: 6, background: "#0b57d0", color: "#ffffff", font: "inherit", fontWeight: 600 }}>Log in</button>
    </main>
  );
}
`;

const badContrastVariant = `
export default function BadContrastVariant() {
  return (
    <main style={{ boxSizing: "border-box", maxWidth: 420, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: "#16181d", background: "#ffffff" }}>
      <h1 style={{ margin: "0 0 16px", fontSize: "1.75rem" }}>Log in</h1>
      <p style={{ color: "#a9a9a9", margin: "0 0 16px" }}>Helper text with weak contrast.</p>
      <button type="button" style={{ minHeight: 44, padding: "12px 18px", border: 0, borderRadius: 6, background: "#0b57d0", color: "#ffffff", font: "inherit", fontWeight: 600 }}>Log in</button>
    </main>
  );
}
`;

const badTypeVariant = `
export default function BadTypeVariant() {
  const count: number = "not a number";
  return <main><h1>{count}</h1></main>;
}
`;

const badRenderVariant = `
export default function BadRenderVariant() {
  throw new Error("Preview failed to render.");
}
`;

function parseJson<T>(content: unknown): T {
  if (!Array.isArray(content)) {
    throw new Error("Tool result content is not an array.");
  }

  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      return JSON.parse(item.text) as T;
    }
  }

  throw new Error("Tool result did not include text content.");
}

async function callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });

  if (result.isError === true) {
    throw new Error(parseJson<{ message?: string }>(result.content).message ?? "Tool failed.");
  }

  return parseJson<T>(result.content);
}

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePath("scope-app"));
  temporaryDirectory = await mkdtemp(path.join(process.cwd(), ".tmp-mcp-directions-"));
  const projectRoot = path.join(temporaryDirectory, "scope-app");

  await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
  await mkdir(path.join(projectRoot, "variants"), { recursive: true });
  await writeFile(path.join(projectRoot, "variants", "good.tsx"), goodVariant);
  await writeFile(path.join(projectRoot, "variants", "bad-contrast.tsx"), badContrastVariant);
  await writeFile(path.join(projectRoot, "variants", "bad-type.tsx"), badTypeVariant);
  await writeFile(path.join(projectRoot, "variants", "bad-render.tsx"), badRenderVariant);

  server = createFittingRoomServer({
    appUrl: fixture.origin,
    auditOutputDir: path.join(temporaryDirectory, "audits"),
    captureOutputDir: path.join(temporaryDirectory, "captures"),
    currentPath: "/login",
    projectRoot,
  });
  client = new Client({ name: "fittingroom-directions-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await callJson("fr_audit", { scope: "auth" });
  directions = await callJson<DirectionsPayload>("fr_directions", { route: "/login" });
});

afterAll(async () => {
  await client.close();
  await server.close();
  await fixture.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("fr_directions", () => {
  it("returns four slots with specs, route evidence, inventory, design system and writing rules", () => {
    expect(directions.route).toBe("/login");
    expect(directions.surface).toBe("app");
    expect(directions.slots).toHaveLength(4);
    expect(directions.slots.map((slot) => slot.slot)).toEqual([1, 2, 3, 4]);
    expect(directions.slots.map((slot) => slot.role)).toEqual([
      "refined",
      "native",
      "bold",
      "wildcard",
    ]);
    expect(directions.slots[0]?.direction).toMatchObject({
      slug: "refined",
      name: "Refined",
      surfaces: ["app"],
    });
    expect(directions.slots[1]?.direction.slug).toBe("clean-ui");
    expect(directions.slots[2]?.direction.slug).toBe("dark-first");
    expect(directions.slots[3]?.direction.slug).toBe("spatial");

    for (const slot of directions.slots) {
      expect(slot.direction.surfaces).toContain("app");
      expect(slot.screenshots).toHaveLength(3);
      expect(slot.contentInventory).toContainEqual(
        expect.objectContaining({ role: "heading", text: "Log in" }),
      );
      expect(slot.contentInventory).toContainEqual(
        expect.objectContaining({ role: "button", text: "Log in" }),
      );
      expect(slot.designSystem.summary).toContain("Tailwind");
      expect(slot.writingRules).toEqual([
        "Write one file per variant.",
        "Use React and Tailwind.",
        "Use project components where they exist.",
        "Keep all real content.",
        "Do not use placeholder or lorem copy.",
      ]);
    }
  });
});

describe("fr_register_variant", () => {
  it("accepts a clean variant and returns its preview screenshot", async () => {
    const result = await callJson<RegisterPayload>("fr_register_variant", {
      slug: "clean-variant",
      filePath: "variants/good.tsx",
      rationale: "Keeps the current look and fixes the audit issues.",
    });

    expect(result.accepted).toBe(true);
    expect(result.typecheck).toEqual({ passed: true, errors: [] });
    expect(result.newFailures).toEqual([]);
    expect(result.screenshotPath).toBeDefined();

    if (result.screenshotPath === undefined) {
      throw new Error("Missing preview screenshot.");
    }

    const screenshot = await stat(result.screenshotPath);

    expect(screenshot.size).toBeGreaterThan(0);
  }, 120_000);

  it("rejects a variant that adds a WCAG AA contrast failure", async () => {
    const result = await callJson<RegisterPayload>("fr_register_variant", {
      slug: "bad-contrast-variant",
      filePath: "variants/bad-contrast.tsx",
      rationale: "Shows a soft helper line under the title.",
    });

    expect(result.accepted).toBe(false);
    expect(result.newFailures).toContainEqual(
      expect.objectContaining({ citation: "wcag22-1.4.3" }),
    );
  }, 120_000);

  it("rejects a variant with type errors before rendering", async () => {
    const result = await callJson<RegisterPayload>("fr_register_variant", {
      slug: "bad-type-variant",
      filePath: "variants/bad-type.tsx",
      rationale: "Introduces a type error.",
    });

    expect(result.accepted).toBe(false);
    expect(result.typecheck?.passed).toBe(false);
    expect(result.typecheck?.errors.length).toBeGreaterThan(0);
  }, 120_000);

  it("rejects a variant that throws while rendering", async () => {
    const result = await callJson<RegisterPayload>("fr_register_variant", {
      slug: "bad-render-variant",
      filePath: "variants/bad-render.tsx",
      rationale: "Throws before rendering a page.",
    });

    expect(result.accepted).toBe(false);
    expect(result.renderErrors?.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("fr_handoff", () => {
  it("writes the brief and reference screenshots for an accepted variant", async () => {
    const result = await callJson<HandoffPayload>("fr_handoff", {
      variantSlug: "clean-variant",
    });
    const brief = await readFile(path.join(result.folder, "brief.md"), "utf8");

    expect(result.handoffId).toMatch(/^handoff-/);
    expect(result.route).toBe("/login");
    expect(result.screenshots.map((screenshot) => screenshot.width)).toEqual([375, 768, 1440]);
    expect(brief).toContain("Apply the design to the real /login route.");
    expect(brief).toContain("Reuse existing project components.");
    expect(brief).toContain("Keep all data wiring and real content.");
    expect(brief).toContain(`Call fr_verify with route /login and handoffId ${result.handoffId}.`);

    const fittingRoom = path.resolve(result.folder, "..", "..");
    const design = await readFile(path.join(fittingRoom, "DESIGN.md"), "utf8");
    const memory = JSON.parse(
      await readFile(path.join(fittingRoom, "design-memory.json"), "utf8"),
    ) as { button?: { backgroundColor?: string }; version?: number };

    expect(design).toContain("## Primary button");
    expect(design).toContain("## Do");
    expect(memory.version).toBe(1);
    expect(memory.button?.backgroundColor).toBeDefined();
  }, 120_000);

  it("verifies the real route and fails when it does not match the handoff", async () => {
    const handoff = await callJson<HandoffPayload>("fr_handoff", {
      variantSlug: "clean-variant",
    });
    const report = await callJson<VerifyPayload>("fr_verify", {
      route: "/login",
      handoffId: handoff.handoffId,
    });

    expect(report.passed).toBe(false);
    expect(report.regionDiffs).toHaveLength(27);
    expect(report.screenshots.map((screenshot) => screenshot.width)).toEqual([375, 768, 1440]);
  }, 120_000);
});
