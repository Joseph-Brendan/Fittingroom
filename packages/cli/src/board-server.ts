import { randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { access, readFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendBoardRequest,
  type BoardApproval,
  type BoardFinding,
  type BoardLock,
  type BoardRequest,
  type BoardState,
  type BoardStatus,
  type BoardVariant,
  type RoundRecord,
  readBoardRequests,
  readBoardState,
  readLiveBoardLock,
  removeBoardLock,
  type StructureAction,
  type StructureFile,
  updateBoardState,
  writeBoardLock,
  writeBoardState,
} from "@fitroom/core";
import { WebSocket, WebSocketServer } from "ws";

export type { BoardApproval, BoardFinding, BoardRequest, BoardState, BoardStatus, BoardVariant };

export interface BoardRoundSummary {
  id: string;
  createdAt: string;
  variants: Array<{ slot: number; name: string; slug?: string }>;
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

export interface BoardRedoInput {
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
  onDirectionRequest?: (request: DirectionRequest) => void;
  pin?: (input: BoardPinInput) => BoardState | Promise<BoardState>;
  port?: number;
  redo?: (input: BoardRedoInput) => BoardEditOutput | Promise<BoardEditOutput>;
  previews?: Record<string, string>;
  projectRoot?: string;
  regenerate?: (input: BoardRegenerateInput) => BoardState | Promise<BoardState>;
  restore?: (input: {
    round: number;
    snapshotId: string;
    state: BoardState;
  }) => BoardState | Promise<BoardState>;
  rounds?: () => RoundRecord[] | Promise<RoundRecord[]>;
  state?: BoardState;
  structure?: () => StructureFile | null | Promise<StructureFile | null>;
  structureAction?: (input: {
    action: StructureAction;
    slug: string;
    state: BoardState;
  }) => BoardState | Promise<BoardState>;
  token?: string;
  undo?: (input: BoardUndoInput) => BoardEditOutput | Promise<BoardEditOutput>;
}

export interface RunningBoardServer {
  close: () => Promise<void>;
  port: number;
  requests: DirectionRequest[];
  reused?: boolean;
  token: string;
  url: string;
}

const defaultBoardPorts = [4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181, 4182, 4183];

function reusedBoardServer(lock: BoardLock): RunningBoardServer {
  return {
    close: async () => {},
    port: lock.port,
    requests: [],
    reused: true,
    token: lock.token,
    url: lock.url,
  };
}

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

function listenOnPort(server: ReturnType<typeof createHttpServer>, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);

      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve(true);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export function createSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

function authorized(url: URL, token: string): boolean {
  return url.searchParams.get("token") === token;
}

async function resolveBoardRoot(): Promise<string> {
  const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(serverDirectory, "board"),
    path.join(serverDirectory, "..", "dist", "board"),
    path.join(serverDirectory, "..", "..", "board", "dist"),
    path.join(serverDirectory, "..", "..", "board"),
  ];

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "index.html"));
      return candidate;
    } catch {}
  }

  throw new Error("The board build was not found. Run pnpm build.");
}

function boardContentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function serveBoardFile(
  response: ServerResponse,
  boardRoot: string,
  pathname: string,
): Promise<void> {
  const relative = pathname.replace(/^\/+/, "");

  if (relative === "") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const filePath = path.resolve(boardRoot, relative);

  if (!filePath.startsWith(`${boardRoot}${path.sep}`)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": boardContentType(filePath),
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function withPreviewBridge(html: string, slug: string): string {
  const script = `<script>
    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" ||
        event.key === "Delete" ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z")
      ) {
        event.preventDefault();
        window.parent.postMessage({
          type: "fitroom:key",
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        }, "*");
      }
    });

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
        type: "fitroom:select",
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
  const projectRoot = options.projectRoot;
  const fitroomDirectory =
    projectRoot === undefined ? undefined : path.join(projectRoot, ".fitroom");

  if (projectRoot !== undefined) {
    const live = await readLiveBoardLock(projectRoot);

    if (live !== null) {
      return reusedBoardServer(live);
    }
  }

  const initial =
    options.state ?? (projectRoot === undefined ? undefined : await readBoardState(projectRoot));

  if (initial === undefined) {
    throw new Error("The board needs a state or a project root.");
  }

  if (projectRoot !== undefined) {
    const statePath = path.join(projectRoot, ".fitroom", "board.json");

    try {
      await access(statePath);
    } catch {
      if (options.state !== undefined) {
        await writeBoardState(projectRoot, options.state);
      }
    }
  }

  let state: BoardState = initial;
  const mergeDisplayState = (next: BoardState): BoardState => ({
    ...next,
    ...(next.designSystem === undefined && state.designSystem !== undefined
      ? { designSystem: state.designSystem }
      : {}),
    ...(next.scopes === undefined && state.scopes !== undefined ? { scopes: state.scopes } : {}),
  });
  let watcher: FSWatcher | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;
  let lockToken: string | undefined;
  const boardRoot = await resolveBoardRoot();
  const previewDirectory =
    projectRoot === undefined ? undefined : path.join(projectRoot, ".fitroom", "previews");
  const sockets = new WebSocketServer({ noServer: true });
  const broadcast = (message: unknown): void => {
    const payload = JSON.stringify(message);

    for (const client of sockets.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };
  const refreshFromFiles = async (): Promise<void> => {
    if (projectRoot === undefined) {
      return;
    }

    try {
      const next = await readBoardState(projectRoot);
      const requestFile = await readBoardRequests(projectRoot);

      state = mergeDisplayState(next);
      broadcast({ type: "board-update", state });
      broadcast({ type: "requests-update", requests: requestFile.requests });
    } catch {}
  };
  const scheduleRefresh = (): void => {
    if (projectRoot === undefined) {
      return;
    }

    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      void refreshFromFiles();
    }, 40);
  };
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

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(html);
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

      if (request.method === "GET" && url.pathname === "/api/rounds") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        sendJson(response, options.rounds === undefined ? [] : await options.rounds());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/structure") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        sendJson(response, options.structure === undefined ? null : await options.structure());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/structure-action") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.structureAction === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Information design is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as { action?: unknown; slug?: unknown };

        if (
          typeof body.slug !== "string" ||
          typeof body.action !== "object" ||
          body.action === null ||
          !("action" in body.action)
        ) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Structure action needs a slug and action.");
          return;
        }

        state = await options.structureAction({
          action: body.action as StructureAction,
          slug: body.slug,
          state,
        });
        broadcast({ type: "board-update", state });
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/request") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        const body = (await readJsonBody(request)) as {
          slot?: number;
          type?: string;
        };
        const types = ["generate", "regenerate", "regenerate-slot", "approve"];

        if (typeof body.type !== "string" || !types.includes(body.type)) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Request needs a type of generate, regenerate, regenerate-slot or approve.");
          return;
        }

        if (projectRoot === undefined) {
          state = { ...state, status: "generating" };
          broadcast({ type: "board-update", state });
          sendJson(response, state);
          return;
        }

        await appendBoardRequest(projectRoot, {
          type: body.type as BoardRequest["type"],
          ...(typeof body.slot === "number" ? { slot: body.slot } : {}),
        });
        state = mergeDisplayState(await readBoardState(projectRoot));
        broadcast({ type: "board-update", state });
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/regenerate") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        const body = (await readJsonBody(request)) as {
          mode?: "light" | "deep";
          slots?: number[];
        };

        if (options.regenerate === undefined) {
          if (projectRoot === undefined) {
            response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
            response.end("Regeneration is not configured.");
            return;
          }

          await appendBoardRequest(projectRoot, {
            type: body.slots?.length === 1 ? "regenerate-slot" : "regenerate",
            ...(body.slots?.length === 1 && body.slots[0] !== undefined
              ? { slot: body.slots[0] }
              : {}),
          });
          state = mergeDisplayState(await readBoardState(projectRoot));
          broadcast({ type: "board-update", state });
          sendJson(response, state);
          return;
        }

        const next = await options.regenerate({
          state,
          ...(body.slots === undefined ? {} : { slots: body.slots }),
          ...(body.mode === undefined ? {} : { mode: body.mode }),
        });

        state = next;
        broadcast({ type: "board-update", state });
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/pin") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
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

        if (options.pin === undefined) {
          const pinVariants = (current: BoardState): BoardState => ({
            ...current,
            variants: current.variants.map((variant) =>
              variant.slot === body.slot ? { ...variant, pinned: body.pinned === true } : variant,
            ),
          });

          state = mergeDisplayState(
            projectRoot === undefined
              ? pinVariants(state)
              : await updateBoardState(projectRoot, pinVariants, state),
          );
          broadcast({ type: "board-update", state });
          sendJson(response, state);
          return;
        }

        const next = await options.pin({
          state,
          slot: body.slot,
          pinned: body.pinned,
        });

        state = next;
        broadcast({ type: "board-update", state });
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/restore") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.restore === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Restoring a round is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as { round?: number; snapshotId?: string };

        if (typeof body.round !== "number" || typeof body.snapshotId !== "string") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Restore needs a round and snapshot id.");
          return;
        }

        state = mergeDisplayState(
          await options.restore({
            round: body.round,
            snapshotId: body.snapshotId,
            state,
          }),
        );
        broadcast({ type: "board-update", state });
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/approve") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        const body = (await readJsonBody(request)) as { slug?: string; slot?: number };
        const variant = state.variants.find(
          (candidate) => candidate.slot === body.slot && candidate.slug === body.slug,
        );

        if (
          typeof body.slug !== "string" ||
          typeof body.slot !== "number" ||
          variant === undefined
        ) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Pick a direction before approving.");
          return;
        }

        const approval: BoardApproval = {
          slot: body.slot,
          slug: body.slug,
          round: state.round,
        };
        const approve = (current: BoardState): BoardState => ({
          ...current,
          approved: approval,
          selected: { slot: approval.slot, slug: approval.slug },
          status: "approved",
        });

        if (projectRoot === undefined) {
          state = approve(state);
        } else {
          state = await updateBoardState(projectRoot, approve, state);
          await appendBoardRequest(projectRoot, { type: "approve", slot: body.slot });
          state = mergeDisplayState(await readBoardState(projectRoot));
        }

        broadcast({ type: "board-update", state });
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

        broadcast({ type: "board-update", state });
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

        broadcast({ type: "board-update", state });
        sendJson(response, state);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/redo") {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (options.redo === undefined) {
          response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
          response.end("Redo is not configured.");
          return;
        }

        const body = (await readJsonBody(request)) as { slug?: string };

        if (typeof body.slug !== "string") {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Redo needs a slug.");
          return;
        }

        const result = await options.redo({ state, slug: body.slug });

        state = result.state;

        if (result.previewHtml !== undefined) {
          previews[body.slug] = result.previewHtml;
        }

        broadcast({ type: "board-update", state });
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

      if (request.method === "GET" && url.pathname.startsWith("/round-assets/")) {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (projectRoot === undefined) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const rest = url.pathname.slice("/round-assets/".length);
        const separator = rest.indexOf("/");

        if (separator === -1) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const roundNumber = decodeURIComponent(rest.slice(0, separator));
        const requested = decodeURIComponent(rest.slice(separator + 1));
        const roundRoot = path.resolve(projectRoot, ".fitroom", "rounds", roundNumber);
        const filePath = path.resolve(roundRoot, requested);

        if (!/^\d+$/.test(roundNumber) || !filePath.startsWith(`${roundRoot}${path.sep}`)) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }

        try {
          const content = await readFile(filePath);

          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": boardContentType(filePath),
          });
          response.end(content);
        } catch {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
        }

        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/preview-assets/")) {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        if (previewDirectory === undefined) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const rest = url.pathname.slice("/preview-assets/".length);
        const separator = rest.indexOf("/");

        if (separator === -1) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const slug = decodeURIComponent(rest.slice(0, separator));
        const requested = decodeURIComponent(rest.slice(separator + 1));
        const filePath = path.resolve(previewDirectory, slug, requested);

        if (!filePath.startsWith(`${path.resolve(previewDirectory, slug)}${path.sep}`)) {
          response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          response.end("Forbidden");
          return;
        }

        try {
          const content = await readFile(filePath);

          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": boardContentType(filePath),
          });
          response.end(content);
        } catch {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
        }

        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/preview/")) {
        if (!authorized(url, token)) {
          response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
          response.end("Unauthorized");
          return;
        }

        const slug = decodeURIComponent(url.pathname.slice("/preview/".length));
        let preview = previews[slug];

        if (preview === undefined && previewDirectory !== undefined) {
          try {
            preview = await readFile(path.join(previewDirectory, slug, "index.html"), "utf8");
          } catch {}
        }

        if (preview === undefined) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const assetPrefix = `/__fitroom/preview/${encodeURIComponent(slug)}/`;
        const boardPrefix = `/preview-assets/${encodeURIComponent(slug)}/`;
        const html = preview
          .replaceAll(assetPrefix, boardPrefix)
          .replace(
            /(src|href)="(\/preview-assets\/[^"]+)"/g,
            (_match, attribute: string, assetPath: string) =>
              `${attribute}="${assetPath}?token=${encodeURIComponent(token)}"`,
          );

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        });
        response.end(withPreviewBridge(html, slug));
        return;
      }

      if (request.method === "GET") {
        await serveBoardFile(response, boardRoot, url.pathname);
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Board server error.");
    });
  });

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

  const ports = options.port === undefined ? defaultBoardPorts : [options.port];
  let listening = false;

  for (const port of ports) {
    if (await listenOnPort(httpServer, port)) {
      listening = true;
      break;
    }
  }

  if (!listening && options.port === undefined) {
    listening = await listenOnPort(httpServer, 0);
  }

  if (!listening) {
    throw new Error(
      options.port === undefined
        ? "The board could not find a free port. Stop the other process and try again."
        : `Port ${options.port} is already in use. Stop the other process or omit --port to use a free port.`,
    );
  }

  const address = httpServer.address();
  const port = address !== null && typeof address !== "string" ? address.port : (options.port ?? 0);
  const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;

  if (projectRoot !== undefined && fitroomDirectory !== undefined) {
    await writeBoardLock(projectRoot, {
      pid: process.pid,
      port,
      token,
      url,
      ...(state.scope.id === "" ? {} : { scopeId: state.scope.id }),
    });
    lockToken = token;
    watcher = watch(fitroomDirectory, (_event, fileName) => {
      const changed = fileName === null ? undefined : String(fileName);

      if (
        changed === undefined ||
        changed === "board.json" ||
        changed === "requests.json" ||
        changed.endsWith(".tmp")
      ) {
        scheduleRefresh();
      }
    });
  }

  return {
    token,
    port,
    url,
    requests,
    close: async () => {
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
      }

      watcher?.close();
      for (const client of sockets.clients) {
        client.terminate();
      }

      await new Promise<void>((resolve) => {
        sockets.close(() => resolve());
      });
      await closeHttpServer(httpServer);

      if (lockToken !== undefined && projectRoot !== undefined) {
        await removeBoardLock(projectRoot);
      }
    },
  };
}
