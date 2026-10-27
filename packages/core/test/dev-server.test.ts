import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectDevServer, detectProjectDevServer } from "../src/index";
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

  it("finds the dev server port declared in the project dev script", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "fitroom-dev-script-"));
    const fixedServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>App</body></html>");
    });

    await writeFile(
      path.join(projectRoot, "package.json"),
      `${JSON.stringify({ scripts: { dev: "next dev -p 3100" } }, null, 2)}\n`,
    );

    await new Promise<void>((resolve, reject) => {
      fixedServer.once("error", reject);
      fixedServer.listen(3100, "127.0.0.1", () => resolve());
    });

    try {
      expect(await detectProjectDevServer(projectRoot)).toBe("http://127.0.0.1:3100");
    } finally {
      await new Promise<void>((resolve) => {
        fixedServer.close(() => resolve());
      });
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("finds a dev server on port 3100 by default", async () => {
    const fixedServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>App</body></html>");
    });

    await new Promise<void>((resolve, reject) => {
      fixedServer.once("error", reject);
      fixedServer.listen(3100, "127.0.0.1", () => resolve());
    });

    try {
      expect(await detectDevServer({ timeoutMs: 1_000 })).toBe("http://127.0.0.1:3100");
    } finally {
      await new Promise<void>((resolve) => {
        fixedServer.close(() => resolve());
      });
    }
  });
});
