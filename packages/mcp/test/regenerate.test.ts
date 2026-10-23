import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setPinnedSlot } from "@fittingroom/core";
import { directionLibrary } from "@fittingroom/directions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFittingRoomServer } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

interface AuditPage {
  path: string;
  screenshots: Array<{ width: number; path: string }>;
}

interface AuditPayload {
  pages: AuditPage[];
}

interface RegeneratedSlot {
  slot: number;
  role: string;
  directionSlug: string | null;
  direction: {
    slug: string;
    name: string;
    surfaces: string[];
  };
  mode?: "light" | "deep";
  screenshotPaths: string[];
}

interface RegeneratePayload {
  changedSlots: number[];
  pinnedSlots: number[];
  slots: RegeneratedSlot[];
  surface: string;
}

let fixture: FixtureServer;
let client: Client;
let server: ReturnType<typeof createFittingRoomServer>;
let temporaryDirectory: string;
let projectRoot: string;
let audit: AuditPayload;

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
  const body = parseJson<T | { message?: string }>(result.content);

  if (result.isError === true) {
    throw new Error(
      "message" in (body as object)
        ? String((body as { message?: string }).message)
        : "Tool failed.",
    );
  }

  return body as T;
}

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePath("scope-app"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-regenerate-"));
  projectRoot = path.join(temporaryDirectory, "scope-app");
  await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
  server = createFittingRoomServer({
    appUrl: fixture.origin,
    auditOutputDir: path.join(temporaryDirectory, "audits"),
    captureOutputDir: path.join(temporaryDirectory, "captures"),
    currentPath: "/login",
    projectRoot,
  });
  client = new Client({ name: "fittingroom-regenerate-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  audit = await callJson<AuditPayload>("fr_audit", { scope: "auth" });
});

afterAll(async () => {
  await client.close();
  await server.close();
  await fixture.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

async function clearHistory(): Promise<void> {
  await rm(path.join(projectRoot, ".fittingroom", "history.json"), { force: true });
}

describe("fr_regenerate", () => {
  it("keeps Refined out of the library and visually close for ten rounds", async () => {
    await clearHistory();

    const login = audit.pages.find((page) => page.path === "/login");
    const baseline = login?.screenshots.find((screenshot) => screenshot.width === 1440);

    expect(baseline).toBeDefined();

    if (baseline === undefined) {
      throw new Error("Missing baseline screenshot.");
    }

    for (let round = 0; round < 10; round += 1) {
      const mode = round % 2 === 0 ? "light" : "deep";
      const result = await callJson<RegeneratePayload>("fr_regenerate", {
        scope: "auth",
        slots: [1],
        mode,
      });
      const refined = result.slots.find((slot) => slot.slot === 1);

      expect(refined?.role).toBe("refined");
      expect(refined?.directionSlug).toBeNull();
      expect(refined?.direction.slug).toBe("refined");
      expect(refined?.mode).toBe(mode);
      expect(directionLibrary.some((direction) => direction.slug === refined?.direction.slug)).toBe(
        false,
      );

      const screenshot = refined?.screenshotPaths.find((screenshotPath) =>
        screenshotPath.endsWith("slot-1-1440.png"),
      );

      expect(screenshot).toBeDefined();

      if (screenshot === undefined) {
        throw new Error("Missing refined screenshot.");
      }

      expect(await readFile(screenshot)).toEqual(await readFile(baseline.path));
    }
  }, 120_000);

  it("does not repeat direction slugs until the surface list runs out", async () => {
    await clearHistory();

    const appDirections = directionLibrary.filter((direction) =>
      direction.surfaces.includes("app"),
    );
    const collected = new Set<string>();

    for (let round = 0; round < 3; round += 1) {
      const result = await callJson<RegeneratePayload>("fr_regenerate", {
        scope: "auth",
        slots: [2, 3, 4],
        mode: "light",
      });

      for (const slot of result.slots.filter((entry) => entry.slot > 1)) {
        expect(slot.direction.surfaces).toContain("app");
        expect(slot.directionSlug).not.toBeNull();

        if (slot.directionSlug !== null) {
          collected.add(slot.directionSlug);
        }
      }
    }

    while (collected.size < appDirections.length) {
      const result = await callJson<RegeneratePayload>("fr_regenerate", {
        scope: "auth",
        slots: [2],
        mode: "light",
      });
      const slot = result.slots.find((entry) => entry.slot === 2);

      if (slot?.directionSlug !== null && slot?.directionSlug !== undefined) {
        collected.add(slot.directionSlug);
      }
    }

    expect(collected.size).toBe(appDirections.length);
  });

  it("never changes a pinned slot", async () => {
    await clearHistory();

    const first = await callJson<RegeneratePayload>("fr_regenerate", {
      scope: "auth",
      mode: "light",
    });
    const pinnedBefore = first.slots.find((slot) => slot.slot === 2);

    expect(pinnedBefore).toBeDefined();

    if (pinnedBefore === undefined) {
      throw new Error("Missing slot 2.");
    }

    await setPinnedSlot(projectRoot, "auth", 2, true);

    const next = await callJson<RegeneratePayload>("fr_regenerate", {
      scope: "auth",
      mode: "deep",
    });
    const pinnedAfter = next.slots.find((slot) => slot.slot === 2);

    expect(next.pinnedSlots).toContain(2);
    expect(next.changedSlots).not.toContain(2);
    expect(pinnedAfter).toEqual(pinnedBefore);
  });
});
