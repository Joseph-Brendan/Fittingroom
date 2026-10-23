import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createFittingRoomServer } from "../src/index";

describe("mcp package", () => {
  it("creates a server that identifies itself as Fitting Room", async () => {
    const server = createFittingRoomServer();
    const client = new Client({ name: "fitting-room-smoke-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    expect(client.getServerVersion()).toMatchObject({
      name: "fitting-room",
      version: "0.0.0",
    });

    await client.close();
    await server.close();
  });
});
