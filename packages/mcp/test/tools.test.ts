import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFittingRoomServer } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

interface ScopesPayload {
  currentPage: string | null;
  defaultScope: { id: string; name: string; routes: string[] } | null;
  defaultSource: string | null;
  scopes: Array<{ id: string; name: string; routes: string[]; selected: boolean }>;
}

interface CapturePayload {
  summary: {
    id: string;
    name: string;
    pages: string[];
    estimatedSeconds: number;
    message: string;
  };
  screenshots: string[];
  pages: Array<{
    path: string;
    screenshots: Array<{ width: number; path: string }>;
    accessibilityTreePath: string;
  }>;
}

interface AuditPayload extends CapturePayload {
  findings: Array<{
    id: string;
    citation: string;
    confidence: string;
    page?: string;
  }>;
  critiqueBrief: string;
}

interface SubmitPayload {
  counts: {
    automated: number;
    judged: number;
    total: number;
  };
  findings: Array<{
    id: string;
    confidence: string;
  }>;
}

let fixture: FixtureServer;
let client: Client;
let server: ReturnType<typeof createFittingRoomServer>;
let temporaryDirectory: string;

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePath("bad-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-mcp-"));
  server = createFittingRoomServer({
    appUrl: fixture.origin,
    auditOutputDir: path.join(temporaryDirectory, "audits"),
    captureOutputDir: path.join(temporaryDirectory, "captures"),
    currentPath: "/login",
    projectRoot: fixturePath("bad-ui"),
  });
  client = new Client({ name: "fittingroom-tools-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await fixture.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

function textContent(content: unknown): string {
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
      return item.text;
    }
  }

  throw new Error("Tool result did not include text content.");
}

function parseJson<T>(content: unknown): T {
  return JSON.parse(textContent(content)) as T;
}

describe("Fitting Room MCP tools", () => {
  it("lists the tools and the heuristic-review prompt", async () => {
    const tools = await client.listTools();
    const prompts = await client.listPrompts();
    const prompt = await client.getPrompt({ name: "heuristic-review" });
    const promptText = prompt.messages
      .map((message) => (message.content.type === "text" ? message.content.text : ""))
      .join("\n");

    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "fr_scopes",
        "fr_capture",
        "fr_audit",
        "fr_directions",
        "fr_regenerate",
        "fr_register_variant",
        "fr_submit_findings",
      ]),
    );
    expect(prompts.prompts.map((entry) => entry.name)).toContain("heuristic-review");
    expect(promptText).toContain("Nielsen's 10 heuristics");
    expect(promptText).toContain("registry");
    expect(promptText).toContain("0 to 4");
    expect(promptText).toContain("judged");
  });

  it("returns every page group and the current page group", async () => {
    const result = await client.callTool({ name: "fr_scopes", arguments: {} });
    const scopes = parseJson<ScopesPayload>(result.content);

    expect(scopes.currentPage).toBe("/login");
    expect(scopes.defaultScope).toMatchObject({ id: "auth", name: "Authentication" });
    expect(scopes.defaultSource).toBe("dev-server");
    expect(scopes.scopes.map((entry) => entry.id)).toEqual([
      "marketing",
      "auth",
      "onboarding",
      "dashboard",
      "app",
      "settings",
      "checkout",
    ]);
    expect(scopes.scopes.find((entry) => entry.id === "auth")?.routes).toEqual([
      "/login",
      "/signup",
    ]);
    expect(scopes.scopes.find((entry) => entry.id === "marketing")?.routes).toEqual([
      "/",
      "/pricing",
    ]);
    expect(scopes.scopes.filter((entry) => entry.selected).map((entry) => entry.id)).toEqual([
      "auth",
    ]);
  });

  it("captures only the selected page group", async () => {
    fixture.requests.length = 0;

    const result = await client.callTool({
      name: "fr_capture",
      arguments: { scope: "auth" },
    });
    const capture = parseJson<CapturePayload>(result.content);

    expect(capture.summary.id).toBe("auth");
    expect(capture.summary.name).toBe("Authentication");
    expect(capture.summary.pages).toEqual(["/login", "/signup"]);
    expect(capture.summary.estimatedSeconds).toBeGreaterThan(0);
    expect(capture.summary.message).toBe(
      "Capturing: Authentication (2 pages): /login /signup, at 375, 768 and 1440 px.",
    );
    expect(capture.screenshots).toHaveLength(6);
    expect(capture.pages.map((page) => page.path)).toEqual(["/login", "/signup"]);

    for (const screenshotPath of capture.screenshots) {
      const file = await stat(screenshotPath);

      expect(file.size).toBeGreaterThan(0);
    }

    const pageRequests = new Set(
      fixture.requests.filter((request) => request !== "/favicon.ico" && request !== "/styles.css"),
    );

    expect(pageRequests).toEqual(new Set(["/login", "/signup"]));
  });

  it("audits a scope, returns a critique brief, then merges judged findings", async () => {
    const auditResult = await client.callTool({
      name: "fr_audit",
      arguments: { scope: "marketing" },
    });
    const audit = parseJson<AuditPayload>(auditResult.content);

    expect(audit.summary.id).toBe("marketing");
    expect(audit.summary.name).toBe("Marketing");
    expect(audit.summary.pages).toEqual(["/", "/pricing"]);
    expect(audit.screenshots.length).toBeGreaterThan(0);
    expect(audit.findings).toHaveLength(3);
    expect(audit.findings.map((finding) => finding.citation).sort()).toEqual([
      "wcag22-1.1.1",
      "wcag22-1.4.3",
      "wcag22-2.4.11",
    ]);
    expect(audit.critiqueBrief).toContain("Nielsen's 10 heuristics");
    expect(audit.critiqueBrief).toContain("fr_submit_findings");

    const rejected = await client.callTool({
      name: "fr_submit_findings",
      arguments: {
        findings: [
          {
            citation: "nielsen-h99",
            confidence: "judged",
            evidence: "The screenshot shows competing calls to action.",
            fix: "Make one action primary.",
            severity: 2,
            title: "Competing primary actions",
          },
        ],
      },
    });

    expect(rejected.isError).toBe(true);
    expect(textContent(rejected.content)).toContain("nielsen-h99");

    const screenshotPath = audit.screenshots[0];

    expect(screenshotPath).toBeDefined();

    if (screenshotPath === undefined) {
      throw new Error("The audit did not return a screenshot.");
    }

    const merged = await client.callTool({
      name: "fr_submit_findings",
      arguments: {
        findings: [
          {
            citation: "nielsen-h4",
            confidence: "judged",
            evidence: {
              selector: ".save-button",
              screenshotPath,
              measuredValue: "Two actions have equal visual weight.",
            },
            fix: "Make Save the primary action and move the other action into the menu.",
            id: "judged-1",
            severity: 2,
            title: "Competing primary actions",
          },
        ],
      },
    });
    const submit = parseJson<SubmitPayload>(merged.content);

    expect(submit.counts).toEqual({ automated: 3, judged: 1, total: 4 });
    expect(submit.findings.find((finding) => finding.id === "judged-1")?.confidence).toBe("judged");
  });

  it("includes screenshots and page details for judged review", async () => {
    const settingsResult = await client.callTool({
      name: "fr_audit",
      arguments: { scope: "settings" },
    });
    const settings = parseJson<AuditPayload>(settingsResult.content);
    const settingsPage = settings.pages.find((page) => page.path === "/settings");

    expect(settings.findings).toEqual([]);
    expect(settingsPage).toBeDefined();

    if (settingsPage === undefined) {
      throw new Error("The audit did not include the settings page.");
    }

    for (const screenshot of settingsPage.screenshots) {
      expect(settings.critiqueBrief).toContain(screenshot.path);
    }

    expect(settings.critiqueBrief).toMatch(/button "Delete project"[^\n]*confirm: none/);
    expect(settings.critiqueBrief).toMatch(/button "Save changes"[^\n]*state: none/);

    const dashboardResult = await client.callTool({
      name: "fr_audit",
      arguments: { scope: "dashboard" },
    });
    const dashboard = parseJson<AuditPayload>(dashboardResult.content);
    const dashboardPage = dashboard.pages.find((page) => page.path === "/dashboard");

    expect(dashboard.findings).toEqual([]);
    expect(dashboardPage).toBeDefined();

    if (dashboardPage === undefined) {
      throw new Error("The audit did not include the dashboard page.");
    }

    for (const screenshot of dashboardPage.screenshots) {
      expect(dashboard.critiqueBrief).toContain(screenshot.path);
    }

    expect(dashboard.critiqueBrief).toContain("Instantiate a new telemetry pipeline");
  });
});
