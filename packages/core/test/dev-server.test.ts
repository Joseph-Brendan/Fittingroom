import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectDevServer } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer(fixturePath("bad-ui"));
});

afterAll(async () => {
  await server.close();
});

describe("detectDevServer", () => {
  it("finds the running app URL on a local dev port", async () => {
    const url = await detectDevServer({
      ports: [server.port],
      timeoutMs: 1_000,
    });

    expect(url).toBe(server.origin);
  });
});
