import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFitroomServer } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const source = `
export default function FreshnessVariant() {
  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: "#16181d", background: "#ffffff" }}>
      <h1 style={{ margin: "0 0 16px", fontSize: "1.75rem" }}>Log in</h1>
      <button type="button" style={{ minHeight: 44, padding: "12px 18px", border: 0, borderRadius: 6, background: "#0b57d0", color: "#ffffff", font: "inherit", fontWeight: 600 }}>Log in</button>
    </main>
  );
}
`;

let fixture: FixtureServer;
let client: Client;
let server: ReturnType<typeof createFitroomServer>;
let temporaryDirectory: string;
let projectRoot: string;
let variantPath: string;

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
  temporaryDirectory = await mkdtemp(path.join(process.cwd(), ".tmp-mcp-handoff-fresh-"));
  projectRoot = path.join(temporaryDirectory, "scope-app");
  await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
  variantPath = path.join(projectRoot, "variants", "fresh.tsx");

  await mkdir(path.dirname(variantPath), { recursive: true });
  await writeFile(variantPath, source);

  server = createFitroomServer({
    appUrl: fixture.origin,
    currentPath: "/login",
    projectRoot,
  });
  client = new Client({ name: "fitroom-handoff-freshness", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await callJson("fr_audit", { scope: "auth" });
  await callJson("fr_directions", { route: "/login" });
  const registered = await callJson<{ accepted: boolean; errors?: string[] }>(
    "fr_register_variant",
    {
      filePath: "variants/fresh.tsx",
      rationale: "Keeps the layout and fixes the login page.",
      slug: "fresh",
    },
  );

  expect(registered.accepted).toBe(true);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await fixture.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("fr_handoff after edits", () => {
  it("renders the current variant file before writing the handoff", async () => {
    const before = await readFile(
      path.join(projectRoot, ".fitroom", "variants", "fresh", "reference", "1440.png"),
    );
    const stamped = await readFile(variantPath, "utf8");

    await writeFile(variantPath, stamped.replace(">Log in</h1>", ">Welcome back</h1>"));

    const handoff = await callJson<{ folder: string }>("fr_handoff", { variantSlug: "fresh" });
    const after = await readFile(path.join(handoff.folder, "reference", "1440.png"));
    const memory = JSON.parse(
      await readFile(path.join(projectRoot, ".fitroom", "design-memory.json"), "utf8"),
    ) as {
      button: { backgroundColor: string };
      colors: Record<string, string>;
    };

    expect(after.equals(before)).toBe(false);
    expect(memory.button.backgroundColor).toBe("rgb(11, 87, 208)");
    expect(Object.values(memory.colors)).toContain("rgb(11, 87, 208)");
  }, 120_000);
});
