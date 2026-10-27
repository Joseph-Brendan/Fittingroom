import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFitroomServer } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const authPages = ["/login", "/signup", "/forgot-password", "/verify"];

interface ScopesPayload {
  currentPage: string;
  currentGroup: string | null;
  defaultScope: { id: string; name: string; routes: string[] } | null;
  defaultSource: string | null;
  scopes: Array<{ id: string; name: string; routes: string[]; selected: boolean }>;
}

interface CapturePayload {
  summary: {
    id: string;
    name: string;
    pages: string[];
    message: string;
  };
  screenshots: string[];
  pages: Array<{ path: string }>;
}

let fixture: FixtureServer;
let client: Client;
let server: ReturnType<typeof createFitroomServer>;
let temporaryDirectory: string;

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePath("scope-app"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-mcp-scopes-"));
  const projectRoot = path.join(temporaryDirectory, "scope-app");

  await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
  await mkdir(path.join(projectRoot, ".fitroom"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".fitroom", "last-request.json"),
    JSON.stringify({ path: "/login" }),
  );

  server = createFitroomServer({
    appUrl: fixture.origin,
    auditOutputDir: path.join(temporaryDirectory, "audits"),
    captureOutputDir: path.join(temporaryDirectory, "captures"),
    projectRoot,
  });
  client = new Client({ name: "fitroom-scope-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await fixture.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

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

describe("MCP scope selection", () => {
  it("selects the dev server route scope and returns the saved scope checklist", async () => {
    const result = await client.callTool({ name: "fr_scopes", arguments: {} });
    const scopes = parseJson<ScopesPayload>(result.content);

    expect(scopes.currentPage).toBe("/login");
    expect(scopes.currentGroup).toBe("auth");
    expect(scopes.defaultSource).toBe("dev-server");
    expect(scopes.defaultScope).toMatchObject({
      id: "auth",
      name: "Authentication",
      routes: authPages,
    });
    expect(scopes.scopes).toHaveLength(5);
    expect(scopes.scopes.filter((scope) => scope.selected).map((scope) => scope.id)).toEqual([
      "auth",
    ]);
    expect(scopes.scopes.find((scope) => scope.id === "marketing")?.routes).toEqual([
      "/",
      "/about",
      "/pricing",
    ]);
  });

  it("returns a scope checklist instead of capturing when there is no default", async () => {
    const projectRoot = path.join(temporaryDirectory, "no-default");
    const serverWithoutDefault = createFitroomServer({
      appUrl: fixture.origin,
      projectRoot,
    });
    const clientWithoutDefault = new Client({
      name: "fitroom-no-default-test",
      version: "0.0.0",
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
    await mkdir(path.join(projectRoot, ".fitroom"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".fitroom", "scopes.json"),
      JSON.stringify({
        version: 1,
        scopes: [{ id: "other", name: "Other", routes: ["/other"] }],
      }),
    );
    await Promise.all([
      serverWithoutDefault.connect(serverTransport),
      clientWithoutDefault.connect(clientTransport),
    ]);

    try {
      const result = await clientWithoutDefault.callTool({
        name: "fr_capture",
        arguments: {},
      });
      const choice = parseJson<{
        needsScope: boolean;
        scopes: Array<{ id: string; selected: boolean }>;
      }>(result.content);

      expect(choice.needsScope).toBe(true);
      expect(choice.scopes).toEqual([expect.objectContaining({ id: "other", selected: false })]);
    } finally {
      await clientWithoutDefault.close();
      await serverWithoutDefault.close();
    }
  });

  it("captures the default scope when no scope is passed", async () => {
    const result = await client.callTool({ name: "fr_capture", arguments: {} });
    const capture = parseJson<CapturePayload>(result.content);

    expect(capture.summary).toMatchObject({
      id: "auth",
      name: "Authentication",
      pages: authPages,
      message:
        "Capturing: Authentication (4 pages): /login /signup /forgot-password /verify, at 375, 768 and 1440 px.",
    });
    expect(capture.pages.map((page) => page.path)).toEqual(authPages);
    expect(capture.screenshots).toHaveLength(12);

    const pageRequests = new Set(
      fixture.requests.filter((request) => request !== "/favicon.ico" && request !== "/styles.css"),
    );

    expect(pageRequests).toEqual(new Set(authPages));
  }, 120_000);
});
