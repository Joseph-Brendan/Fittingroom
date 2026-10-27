import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createFitroomServer } from "../src/index";

describe("mcp package", () => {
  it("creates a server that identifies itself as Fitroom", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };

    if (typeof manifest.version !== "string") {
      throw new Error("packages/mcp/package.json needs a version.");
    }

    const server = createFitroomServer();
    const client = new Client({ name: "fitroom-smoke-test", version: manifest.version });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerVersion()).toMatchObject({
      name: "fitroom",
      version: manifest.version,
    });

    await client.close();
    await server.close();
  });
});
