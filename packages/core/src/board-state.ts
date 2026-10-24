import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fittingRoomFilePath, writeFittingRoomJson, writeJsonAtomic } from "./fittingroom-store";

export const boardStatuses = [
  "empty",
  "generating",
  "directions_ready",
  "approved",
  "handoff_created",
  "verifying",
  "verified",
  "verify_failed",
] as const;

export type BoardStatus = (typeof boardStatuses)[number];

export interface BoardScope {
  id: string;
  name: string;
}

export interface BoardVariant {
  slug: string;
  name: string;
  rationale: string;
  slot: number;
  pinned: boolean;
  mode?: "light" | "deep";
  role?: "refined" | "native" | "bold" | "wildcard";
  filePath?: string;
  previewPath?: string;
  screenshotPath?: string;
}

export interface BoardFinding {
  id: string;
  title: string;
  citation: string;
  citationUrl: string;
  severity: number;
  confidence: "measured" | "judged";
  variantSlug: string;
  fix: string;
  page?: string;
}

export interface BoardRoundSummary {
  id: string;
  createdAt: string;
  variants: Array<{ slot: number; name: string; slug?: string }>;
}

export interface BoardSelection {
  slot: number;
  slug: string;
}

export interface BoardApproval {
  slot: number;
  slug: string;
  round: number;
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
  version: 2;
  page?: string;
  scope: BoardScope;
  scopes?: BoardScope[];
  surface?: "marketing" | "app" | "dashboard";
  designSystem?: BoardDesignSystem;
  round: number;
  status: BoardStatus;
  variants: BoardVariant[];
  findings: BoardFinding[];
  previousRounds: BoardRoundSummary[];
  selected: BoardSelection | null;
  approved: BoardApproval | null;
  previews?: Record<string, string>;
}

export type BoardRequestType = "generate" | "regenerate" | "regenerate-slot" | "approve";

export interface BoardRequest {
  id: string;
  type: BoardRequestType;
  slot: number | null;
  scopeId: string;
  round: number;
  createdAt: string;
  completedAt?: string;
}

export interface BoardRequestsFile {
  version: 1;
  requests: BoardRequest[];
}

export interface BoardLock {
  version: 1;
  pid: number;
  port: number;
  token: string;
  url: string;
  scopeId?: string;
  createdAt: string;
}

export interface BoardLockInput {
  pid: number;
  port: number;
  token: string;
  url: string;
  scopeId?: string;
}

export type BoardWaitEvent =
  | { timedOut: true }
  | {
      timedOut: false;
      board: BoardState;
      approval?: BoardApproval;
      request?: BoardRequest;
    };

const requestTypes = new Set<BoardRequestType>([
  "generate",
  "regenerate",
  "regenerate-slot",
  "approve",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  const entry = value[field];

  return typeof entry === "string" && entry.trim() !== "" ? entry : null;
}

function optionalString(value: Record<string, unknown>, field: string): string | undefined {
  const entry = value[field];

  return typeof entry === "string" && entry.trim() !== "" ? entry : undefined;
}

function numberField(value: Record<string, unknown>, field: string): number | null {
  const entry = value[field];

  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}

function parseScope(value: unknown): BoardScope | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringField(value, "id");
  const name = stringField(value, "name");

  return id === null || name === null ? null : { id, name };
}

function parseVariant(value: unknown): BoardVariant | null {
  if (!isRecord(value)) {
    return null;
  }

  const slug = stringField(value, "slug");
  const name = stringField(value, "name");
  const rationale = stringField(value, "rationale");
  const slot = numberField(value, "slot");

  if (slug === null || name === null || rationale === null || slot === null) {
    return null;
  }

  const mode = value.mode === "deep" || value.mode === "light" ? value.mode : undefined;
  const role =
    value.role === "refined" ||
    value.role === "native" ||
    value.role === "bold" ||
    value.role === "wildcard"
      ? value.role
      : undefined;
  const filePath = optionalString(value, "filePath");
  const previewPath = optionalString(value, "previewPath");
  const screenshotPath = optionalString(value, "screenshotPath");

  return {
    slug,
    name,
    rationale,
    slot,
    pinned: value.pinned === true,
    ...(mode === undefined ? {} : { mode }),
    ...(role === undefined ? {} : { role }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(previewPath === undefined ? {} : { previewPath }),
    ...(screenshotPath === undefined ? {} : { screenshotPath }),
  };
}

function parseFinding(value: unknown): BoardFinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringField(value, "id");
  const title = stringField(value, "title");
  const citation = stringField(value, "citation");
  const citationUrl = stringField(value, "citationUrl");
  const severity = numberField(value, "severity");
  const confidence = value.confidence === "judged" ? "judged" : "measured";
  const variantSlug = typeof value.variantSlug === "string" ? value.variantSlug : "";
  const fix = stringField(value, "fix");

  if (
    id === null ||
    title === null ||
    citation === null ||
    citationUrl === null ||
    severity === null ||
    fix === null
  ) {
    return null;
  }

  const page = optionalString(value, "page");

  return {
    id,
    title,
    citation,
    citationUrl,
    severity,
    confidence,
    variantSlug,
    fix,
    ...(page === undefined ? {} : { page }),
  };
}

function parseRound(value: unknown): BoardRoundSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringField(value, "id");
  const createdAt = stringField(value, "createdAt");

  if (id === null || createdAt === null || !Array.isArray(value.variants)) {
    return null;
  }

  const variants = value.variants.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const slot = numberField(entry, "slot");
    const name = stringField(entry, "name");

    if (slot === null || name === null) {
      return [];
    }

    const slug = optionalString(entry, "slug");

    return [{ slot, name, ...(slug === undefined ? {} : { slug }) }];
  });

  return { id, createdAt, variants };
}

function parseApproval(value: unknown): BoardApproval | null {
  if (!isRecord(value)) {
    return null;
  }

  const slug = stringField(value, "slug");
  const slot = numberField(value, "slot");
  const round = numberField(value, "round");

  return slug === null || slot === null || round === null ? null : { slot, slug, round };
}

function parseSelection(value: unknown): BoardSelection | null {
  if (!isRecord(value)) {
    return null;
  }

  const slug = stringField(value, "slug");
  const slot = numberField(value, "slot");

  return slug === null || slot === null ? null : { slot, slug };
}

function parseDesignSystem(value: unknown): BoardDesignSystem | undefined {
  if (!isRecord(value) || !isRecord(value.tokens)) {
    return undefined;
  }

  const status = value.status === "connected" || value.status === "partial" ? value.status : "none";
  const summary = typeof value.summary === "string" ? value.summary : "";
  const components = Array.isArray(value.components)
    ? value.components.filter((entry): entry is string => typeof entry === "string")
    : [];
  const tokens = value.tokens as Record<string, unknown>;
  const categories = ["color", "space", "radius", "font", "fontSize", "shadow"] as const;
  const parsedTokens = Object.fromEntries(
    categories.map((category) => {
      const group = tokens[category];

      return [
        category,
        isRecord(group)
          ? Object.fromEntries(
              Object.entries(group).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
      ];
    }),
  ) as BoardDesignSystem["tokens"];

  return { status, summary, components, tokens: parsedTokens };
}

function parseStatus(value: unknown, fallback: BoardStatus): BoardStatus {
  return typeof value === "string" && boardStatuses.includes(value as BoardStatus)
    ? (value as BoardStatus)
    : fallback;
}

export function emptyBoardState(scope: BoardScope = { id: "", name: "" }): BoardState {
  return {
    version: 2,
    scope,
    round: 0,
    status: "empty",
    variants: [],
    findings: [],
    previousRounds: [],
    selected: null,
    approved: null,
  };
}

export function parseBoardState(value: unknown): BoardState {
  if (!isRecord(value)) {
    throw new Error("The board state must be an object.");
  }

  const scope = parseScope(value.scope);

  if (scope === null) {
    throw new Error("The board state needs a scope with an id and name.");
  }

  if (value.variants !== undefined && !Array.isArray(value.variants)) {
    throw new Error("The board state needs a variants array.");
  }

  if (value.findings !== undefined && !Array.isArray(value.findings)) {
    throw new Error("The board state needs a findings array.");
  }

  if (value.previousRounds !== undefined && !Array.isArray(value.previousRounds)) {
    throw new Error("The board state previousRounds must be an array.");
  }

  const variants = Array.isArray(value.variants)
    ? value.variants.flatMap((entry) => {
        const variant = parseVariant(entry);

        return variant === null ? [] : [variant];
      })
    : [];
  const findings = Array.isArray(value.findings)
    ? value.findings.flatMap((entry) => {
        const finding = parseFinding(entry);

        return finding === null ? [] : [finding];
      })
    : [];
  const previousRounds = Array.isArray(value.previousRounds)
    ? value.previousRounds.flatMap((entry) => {
        const round = parseRound(entry);

        return round === null ? [] : [round];
      })
    : [];
  const scopes = Array.isArray(value.scopes)
    ? value.scopes.flatMap((entry) => {
        const parsed = parseScope(entry);

        return parsed === null ? [] : [parsed];
      })
    : undefined;
  const approved = parseApproval(value.approved);
  const inferredStatus: BoardStatus =
    approved === null ? (variants.length === 0 ? "empty" : "directions_ready") : "approved";
  const round =
    typeof value.round === "number" && Number.isFinite(value.round)
      ? value.round
      : previousRounds.length + (variants.length === 0 ? 0 : 1);
  const surface =
    value.surface === "marketing" || value.surface === "dashboard" || value.surface === "app"
      ? value.surface
      : undefined;
  const page = optionalString(value, "page");
  const designSystem = parseDesignSystem(value.designSystem);
  const previews = isRecord(value.previews)
    ? Object.fromEntries(
        Object.entries(value.previews).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;

  return {
    version: 2,
    scope,
    ...(page === undefined ? {} : { page }),
    ...(scopes === undefined ? {} : { scopes }),
    ...(surface === undefined ? {} : { surface }),
    ...(designSystem === undefined ? {} : { designSystem }),
    round,
    status: parseStatus(value.status, inferredStatus),
    variants,
    findings,
    previousRounds,
    selected: parseSelection(value.selected),
    approved,
    ...(previews === undefined ? {} : { previews }),
  };
}

export async function readBoardState(projectRoot: string): Promise<BoardState> {
  try {
    return parseBoardState(
      JSON.parse(await readFile(fittingRoomFilePath(projectRoot, "board.json"), "utf8")) as unknown,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyBoardState();
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Could not read ${fittingRoomFilePath(projectRoot, "board.json")}. The file is not valid JSON. Fix the file or delete it and run the command again.`,
      );
    }

    throw error;
  }
}

export async function writeBoardState(projectRoot: string, state: BoardState): Promise<void> {
  await writeFittingRoomJson(projectRoot, "board.json", state);
}

export async function updateBoardState(
  projectRoot: string,
  update: (state: BoardState) => BoardState | Promise<BoardState>,
  fallback: BoardState = emptyBoardState(),
): Promise<BoardState> {
  let state: BoardState;

  try {
    state = await readBoardState(projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      state = fallback;
    } else {
      throw error;
    }
  }

  if (state.scope.id === "" && fallback.scope.id !== "") {
    state = fallback;
  }

  const next = await update(state);

  await writeBoardState(projectRoot, next);

  return next;
}

function parseRequest(value: unknown): BoardRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringField(value, "id");
  const type = stringField(value, "type");
  const scopeId = typeof value.scopeId === "string" ? value.scopeId : "";
  const createdAt = stringField(value, "createdAt");

  if (
    id === null ||
    type === null ||
    createdAt === null ||
    !requestTypes.has(type as BoardRequestType)
  ) {
    return null;
  }

  const slot = numberField(value, "slot");
  const round = numberField(value, "round");
  const completedAt = optionalString(value, "completedAt");

  return {
    id,
    type: type as BoardRequestType,
    slot,
    scopeId,
    round: round ?? 0,
    createdAt,
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

export async function readBoardRequests(projectRoot: string): Promise<BoardRequestsFile> {
  try {
    const raw = JSON.parse(
      await readFile(fittingRoomFilePath(projectRoot, "requests.json"), "utf8"),
    ) as unknown;

    if (!isRecord(raw) || !Array.isArray(raw.requests)) {
      throw new Error("The requests file needs a requests array.");
    }

    return {
      version: 1,
      requests: raw.requests.flatMap((entry) => {
        const request = parseRequest(entry);

        return request === null ? [] : [request];
      }),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, requests: [] };
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Could not read ${fittingRoomFilePath(projectRoot, "requests.json")}. The file is not valid JSON. Fix the file or delete it and run the command again.`,
      );
    }

    throw error;
  }
}

export async function writeBoardRequests(
  projectRoot: string,
  file: BoardRequestsFile,
): Promise<void> {
  await writeFittingRoomJson(projectRoot, "requests.json", file);
}

export async function appendBoardRequest(
  projectRoot: string,
  input: { type: BoardRequestType; slot?: number },
): Promise<BoardRequest> {
  const state = await readBoardState(projectRoot);
  const file = await readBoardRequests(projectRoot);
  const request: BoardRequest = {
    id: `req-${randomUUID().slice(0, 8)}`,
    type: input.type,
    slot: input.slot ?? null,
    scopeId: state.scope.id,
    round: state.round,
    createdAt: new Date().toISOString(),
  };

  file.requests.push(request);
  await writeBoardRequests(projectRoot, file);

  if (
    input.type === "generate" ||
    input.type === "regenerate" ||
    input.type === "regenerate-slot"
  ) {
    await writeBoardState(projectRoot, { ...state, status: "generating" });
  }

  return request;
}

export async function completeBoardRequest(projectRoot: string, id: string): Promise<BoardRequest> {
  const file = await readBoardRequests(projectRoot);
  const index = file.requests.findIndex((request) => request.id === id);

  if (index === -1) {
    throw new Error(`Request ${id} was not found. Run fr_board_status to list open requests.`);
  }

  const existing = file.requests[index];

  if (existing === undefined) {
    throw new Error(`Request ${id} was not found. Run fr_board_status to list open requests.`);
  }

  const request: BoardRequest = {
    ...existing,
    completedAt: existing.completedAt ?? new Date().toISOString(),
  };

  file.requests[index] = request;
  await writeBoardRequests(projectRoot, file);

  return request;
}

export function openBoardRequests(file: BoardRequestsFile): BoardRequest[] {
  return file.requests.filter((request) => request.completedAt === undefined);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForBoardEvent(
  projectRoot: string,
  timeoutMilliseconds = 600_000,
): Promise<BoardWaitEvent> {
  const deadline = Date.now() + Math.max(0, timeoutMilliseconds);

  while (Date.now() <= deadline) {
    const board = await readBoardState(projectRoot);

    if (board.status === "approved" && board.approved !== null) {
      return { timedOut: false, board, approval: board.approved };
    }

    const requests = await readBoardRequests(projectRoot);
    const open = openBoardRequests(requests)[0];

    if (open !== undefined) {
      return { timedOut: false, board, request: open };
    }

    if (deadline - Date.now() <= 0) {
      break;
    }

    await delay(100);
  }

  return { timedOut: true };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readBoardLock(projectRoot: string): Promise<BoardLock | null> {
  try {
    const raw = JSON.parse(
      await readFile(fittingRoomFilePath(projectRoot, "board.lock"), "utf8"),
    ) as unknown;

    if (!isRecord(raw)) {
      return null;
    }

    const pid = numberField(raw, "pid");
    const port = numberField(raw, "port");
    const token = stringField(raw, "token");
    const url = stringField(raw, "url");
    const createdAt = stringField(raw, "createdAt");

    if (pid === null || port === null || token === null || url === null || createdAt === null) {
      return null;
    }

    const scopeId = optionalString(raw, "scopeId");

    return {
      version: 1,
      pid,
      port,
      token,
      url,
      ...(scopeId === undefined ? {} : { scopeId }),
      createdAt,
    };
  } catch {
    return null;
  }
}

export async function readLiveBoardLock(projectRoot: string): Promise<BoardLock | null> {
  const lock = await readBoardLock(projectRoot);

  if (lock === null || !processIsAlive(lock.pid)) {
    return null;
  }

  return lock;
}

export async function writeBoardLock(
  projectRoot: string,
  input: BoardLockInput,
): Promise<BoardLock> {
  const lock: BoardLock = {
    version: 1,
    pid: input.pid,
    port: input.port,
    token: input.token,
    url: input.url,
    ...(input.scopeId === undefined ? {} : { scopeId: input.scopeId }),
    createdAt: new Date().toISOString(),
  };

  await writeJsonAtomic(fittingRoomFilePath(projectRoot, "board.lock"), lock);

  return lock;
}

export async function removeBoardLock(projectRoot: string): Promise<void> {
  await rm(fittingRoomFilePath(projectRoot, "board.lock"), { force: true });
}

export function boardRequestSentence(request: BoardRequest): string {
  switch (request.type) {
    case "generate":
      return "Ask your agent: Generate 4 design directions for this page group.";
    case "regenerate":
      return "Ask your agent: Regenerate the unpinned directions for this page group.";
    case "regenerate-slot":
      return `Ask your agent: Regenerate slot ${request.slot ?? ""} for this page group.`;
    case "approve":
      return "Ask your agent: Read the approved direction from the board and create a handoff.";
  }
}

export function requestFilePath(projectRoot: string): string {
  return path.join(projectRoot, ".fittingroom", "requests.json");
}
