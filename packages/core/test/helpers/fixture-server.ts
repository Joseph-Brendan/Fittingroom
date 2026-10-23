import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FixtureServer {
  origin: string;
  port: number;
  requests: string[];
  close: () => Promise<void>;
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("The fixture server did not return a TCP address."));
        return;
      }

      resolve(address);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startFixtureServer(fixtureRoot: string): Promise<FixtureServer> {
  const root = path.resolve(fixtureRoot);
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    requests.push(pathname);

    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    const relativePath = pathname === "/" ? "index.html" : `${pathname.replace(/^\/+/, "")}.html`;
    const filePath = path.resolve(root, relativePath);

    if (!filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const html = await readFile(filePath, "utf8");

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(request.method === "HEAD" ? undefined : html);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  const address = await listen(server);
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    port: address.port,
    requests,
    close: () => close(server),
  };
}

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../../fixtures/${name}`, import.meta.url));
}
