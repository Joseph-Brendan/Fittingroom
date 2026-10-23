import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { type WebSocket, WebSocketServer } from "ws";

export interface BoardFinding {
  id: string;
  title: string;
  citation: string;
  citationUrl: string;
  severity: number;
  confidence: "measured" | "judged";
  variantSlug: string;
  fix: string;
}

export interface BoardVariant {
  slug: string;
  name: string;
  rationale: string;
  slot: number;
  pinned: boolean;
  mode?: "light" | "deep";
}

export interface BoardRoundSummary {
  id: string;
  createdAt: string;
  variants: Array<{ slot: number; name: string }>;
}

export interface BoardDesignSystem {
  components: string[];
  status: "connected" | "partial" | "none";
  summary: string;
  tokens: {
    color: Record<string, string>;
    font: Record<string, string>;
    fontSize: Record<string, string>;
    radius: Record<string, string>;
    shadow: Record<string, string>;
    space: Record<string, string>;
  };
}

export interface BoardState {
  scope: {
    id: string;
    name: string;
  };
  surface?: "marketing" | "app" | "dashboard";
  designSystem?: BoardDesignSystem;
  variants: BoardVariant[];
  findings: BoardFinding[];
  previousRounds: BoardRoundSummary[];
}

export interface BoardEditOperation {
  [key: string]: unknown;
  op: string;
}

export interface BoardEditInput {
  operation: BoardEditOperation;
  slug: string;
  state: BoardState;
}

export interface BoardEditOutput {
  previewHtml?: string;
  state: BoardState;
}

export interface BoardUndoInput {
  slug: string;
  state: BoardState;
}

export interface BoardRegenerateInput {
  mode?: "light" | "deep";
  slots?: number[];
  state: BoardState;
}

export interface BoardPinInput {
  pinned: boolean;
  slot: number;
  state: BoardState;
}

export interface DirectionRequest {
  request: string;
  scopeId: string;
  receivedAt: string;
}

export interface BoardServerOptions {
  edit?: (input: BoardEditInput) => BoardEditOutput | Promise<BoardEditOutput>;
  undo?: (input: BoardUndoInput) => BoardEditOutput | Promise<BoardEditOutput>;
  pin?: (input: BoardPinInput) => BoardState | Promise<BoardState>;
  port?: number;
  previews?: Record<string, string>;
  regenerate?: (input: BoardRegenerateInput) => BoardState | Promise<BoardState>;
  state: BoardState;
  token?: string;
  onDirectionRequest?: (request: DirectionRequest) => void;
}

export interface RunningBoardServer {
  close: () => Promise<void>;
  port: number;
  requests: DirectionRequest[];
  token: string;
  url: string;
}

const require = createRequire(import.meta.url);

function closeHttpServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
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

export function createSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

function authorized(url: URL, token: string): boolean {
  return url.searchParams.get("token") === token;
}

function withPreviewBridge(html: string, slug: string): string {
  const script = `<script>
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest("[data-fr-id]");
      if (!(element instanceof HTMLElement)) return;
      event.preventDefault();
      const parent = element.parentElement?.closest("[data-fr-id]") ?? null;
      const siblings = parent === null ? [] : Array.from(parent.children)
        .filter((child) => child.hasAttribute("data-fr-id"))
        .map((child) => ({
          id: child.getAttribute("data-fr-id") ?? "",
          label: (child.textContent ?? "").trim().slice(0, 40),
        }));
      window.parent.postMessage({
        type: "fitting-room:select",
        slug: ${JSON.stringify(slug)},
        id: element.getAttribute("data-fr-id") ?? "",
        label: (element.textContent ?? "").trim().slice(0, 40),
        parentId: parent?.getAttribute("data-fr-id") ?? null,
        siblings,
      }, "*");
    });
  </script>`;
  return html.includes("</body>")
    ? html.replace("</body>", `${script}</body>`)
    : `${html}${script}`;
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";

  for await (const chunk of request) {
    body += String(chunk);
  }

  return JSON.parse(body === "" ? "{}" : body) as unknown;
}

export async function startBoardServer(options: BoardServerOptions): Promise<RunningBoardServer> {
  const token = options.token ?? createSessionToken();
  const previews = options.previews ?? {};
  const requests: DirectionRequest[] = [];
  const editRequests: BoardEditOperation[] = [];
  let state = options.state;
  const boardRoot = path.dirname(require.resolve("@fittingroom/board/package.json"));
  const vite = await createViteServer({
    appType: "custom",
    root: boardRoot,
    server: {
      hmr: false,
      host: "127.0.0.1",
      middlewareMode: true,
    },
  });
  const httpServer = createHttpServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      response.setHeader("x-content-type-options", "nosniff");

      if (url.pathname === "/health") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok");
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        const html = await readFile(path.join(boardRoot, "index.html"), "utf8");
        const transformed = await vite.transformIndexHtml(url.pathname, html);

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(transformed);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/board") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/regenerate") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.regenerate === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Regeneration is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as {
          mode?: "light" | "deep";
          slots?: number[];
        };
        const next = await options.regenerate({
          state,
          ...(body.slots === undefined ? {} : { slots: body.slots }),
          ...(body.mode === undefined ? {} : { mode: body.mode }),
        });

        state = next;
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pin") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.pin === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Pinning is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as {
          pinned?: boolean;
          slot?: number;
        };

        if (typeof body.slot !== "number" || typeof body.pinned !== "boolean") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Pin needs a slot and pinned value.");
          return;
        }

        const next = await options.pin({
          state,
          slot: body.slot,
          pinned: body.pinned,
        });

        state = next;
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/edit") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.edit === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Editing is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as {
          operation?: BoardEditOperation;
          slug?: string;
        };

        if (typeof body.slug !== "string" || body.operation === undefined) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Edit needs a slug and operation.");
          return;
        }

        const result = await options.edit({
          state,
          slug: body.slug,
          operation: body.operation,
        });

        state = result.state;
        editRequests.push(body.operation);

        if (result.previewHtml !== undefined) {
          previews[body.slug] = result.previewHtml;
        }

        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/undo") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.undo === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Undo is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as { slug?: string };

        if (typeof body.slug !== "string") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Undo needs a slug.");
          return;
        }

        const result = await options.undo({ state, slug: body.slug });

        state = result.state;

        if (result.previewHtml !== undefined) {
          previews[body.slug] = result.previewHtml;
        }

        sendJson(response, state);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/edit-log") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        sendJson(response, editRequests);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/direction-requests") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        sendJson(response, requests);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/preview/")) {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        const slug = decodeURIComponent(url.pathname.slice("/preview/".length));
        const preview = previews[slug];

        if (preview === undefined) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(withPreviewBridge(preview, slug));
        return;
      }

      vite.middlewares(request, response, () => {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      });
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Board server error.");
    });
  });
  const sockets = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== "/ws" || !authorized(url, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    sockets.handleUpgrade(request, socket, head, (client) => {
      sockets.emit("connection", client, request);
    });
  });

  sockets.on("connection", (client: WebSocket) => {
    client.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: unknown;
          request?: unknown;
        };

        if (message.type !== "direction-request" || typeof message.request !== "string") {
          client.send(JSON.stringify({ type: "error", message: "Invalid request." }));
          return;
        }

        const request = message.request.trim();

        if (request === "") {
          client.send(JSON.stringify({ type: "error", message: "Add a direction request." }));
          return;
        }

        const entry: DirectionRequest = {
          request,
          scopeId: state.scope.id,
          receivedAt: new Date().toISOString(),
        };

        requests.push(entry);
        options.onDirectionRequest?.(entry);
        client.send(JSON.stringify({ type: "direction-request-ack", request }));
      } catch {
        client.send(JSON.stringify({ type: "error", message: "Invalid message." }));
      }
    });
  });

  const requestedPort = options.port ?? 4173;

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const port = address !== null && typeof address !== "string" ? address.port : requestedPort;
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;

  return {
    token,
    port,
    url,
    requests,
    close: async () => {
      for (const client of sockets.clients) {
        client.terminate();
      }

      await new Promise<void>((resolve) => {
        sockets.close(() => resolve());
      });
      await vite.close();
      await closeHttpServer(httpServer);
    },
  };
}
