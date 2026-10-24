import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { type BoardScope, type BoardState, readBoardState, writeBoardState } from "./board-state";
import { writeJsonAtomic } from "./fittingroom-store";
import {
  readRegenerationHistory,
  type VariantRole,
  writeRegenerationHistory,
} from "./regeneration";

export interface RoundVariantSnapshot {
  id: string;
  slot: number;
  role: VariantRole;
  slug: string;
  name: string;
  rationale: string;
  file: string;
  orig: string | null;
  editLog: string | null;
  screenshot: string | null;
  current: boolean;
  createdAt: string;
}

export interface RoundRecord {
  version: 1;
  id: string;
  number: number;
  createdAt: string;
  scope: BoardScope;
  variants: RoundVariantSnapshot[];
}

export interface SaveRoundSnapshotInput {
  number: number;
  scope: BoardScope;
  variant: {
    editLogPath?: string | undefined;
    filePath: string;
    name: string;
    origPath?: string | undefined;
    rationale: string;
    role: VariantRole;
    screenshotPath?: string | undefined;
    slug: string;
    slot: number;
  };
}

export interface RestoreRoundInput {
  round: number;
  scope: BoardScope;
  snapshotId: string;
}

function roundsDirectory(projectRoot: string): string {
  return path.join(projectRoot, ".fittingroom", "rounds");
}

export function roundDirectory(projectRoot: string, number: number): string {
  return path.join(roundsDirectory(projectRoot), String(number));
}

function roundFilePath(projectRoot: string, number: number): string {
  return path.join(roundDirectory(projectRoot, number), "round.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSnapshot(value: unknown): RoundVariantSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const slot = value.slot;
  const role = value.role;
  const slug = value.slug;
  const name = value.name;
  const rationale = value.rationale;
  const file = value.file;
  const createdAt = value.createdAt;

  if (
    typeof id !== "string" ||
    typeof slot !== "number" ||
    (role !== "refined" && role !== "native" && role !== "bold" && role !== "wildcard") ||
    typeof slug !== "string" ||
    typeof name !== "string" ||
    typeof rationale !== "string" ||
    typeof file !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  return {
    id,
    slot,
    role,
    slug,
    name,
    rationale,
    file,
    orig: typeof value.orig === "string" ? value.orig : null,
    editLog: typeof value.editLog === "string" ? value.editLog : null,
    screenshot: typeof value.screenshot === "string" ? value.screenshot : null,
    current: value.current === true,
    createdAt,
  };
}

function parseRound(value: unknown): RoundRecord | null {
  if (!isRecord(value) || value.version !== 1) {
    return null;
  }

  const id = value.id;
  const number = value.number;
  const createdAt = value.createdAt;
  const scope = value.scope;

  if (
    typeof id !== "string" ||
    typeof number !== "number" ||
    typeof createdAt !== "string" ||
    !isRecord(scope) ||
    typeof scope.id !== "string" ||
    typeof scope.name !== "string" ||
    !Array.isArray(value.variants)
  ) {
    return null;
  }

  return {
    version: 1,
    id,
    number,
    createdAt,
    scope: { id: scope.id, name: scope.name },
    variants: value.variants.flatMap((entry) => {
      const snapshot = parseSnapshot(entry);

      return snapshot === null ? [] : [snapshot];
    }),
  };
}

async function readRound(projectRoot: string, number: number): Promise<RoundRecord | null> {
  try {
    const parsed = parseRound(
      JSON.parse(await readFile(roundFilePath(projectRoot, number), "utf8")) as unknown,
    );

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeRound(projectRoot: string, round: RoundRecord): Promise<void> {
  await writeJsonAtomic(roundFilePath(projectRoot, round.number), round);
}

export async function ensureRound(
  projectRoot: string,
  number: number,
  scope: BoardScope,
): Promise<RoundRecord> {
  const existing = await readRound(projectRoot, number);

  if (existing !== null) {
    if (existing.scope.id === "" && scope.id !== "") {
      existing.scope = scope;
      await writeRound(projectRoot, existing);
    }

    return existing;
  }

  const round: RoundRecord = {
    version: 1,
    id: String(number),
    number,
    createdAt: new Date().toISOString(),
    scope,
    variants: [],
  };

  await mkdir(roundDirectory(projectRoot, number), { recursive: true });
  await writeRound(projectRoot, round);

  return round;
}

export async function listRounds(projectRoot: string): Promise<RoundRecord[]> {
  let entries: string[];

  try {
    entries = await readdir(roundsDirectory(projectRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const rounds: RoundRecord[] = [];

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }

    const round = await readRound(projectRoot, Number(entry));

    if (round !== null) {
      rounds.push(round);
    }
  }

  return rounds.sort((first, second) => first.number - second.number);
}

async function copyIfPresent(source: string | undefined, target: string): Promise<string | null> {
  if (source === undefined) {
    return null;
  }

  try {
    await copyFile(source, target);

    return path.basename(target);
  } catch {
    return null;
  }
}

function projectPath(projectRoot: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

export async function saveRoundSnapshot(
  projectRoot: string,
  input: SaveRoundSnapshotInput,
): Promise<RoundVariantSnapshot> {
  const round = await ensureRound(projectRoot, input.number, input.scope);
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  const id = `${input.variant.slot}-${input.variant.slug}-${suffix}`;
  const directory = roundDirectory(projectRoot, input.number);
  const file = `slot-${input.variant.slot}-${input.variant.slug}-${suffix}.tsx`;
  const orig = `slot-${input.variant.slot}-${input.variant.slug}-${suffix}.orig.tsx`;
  const editLog = `slot-${input.variant.slot}-${input.variant.slug}-${suffix}.edits.json`;
  const screenshot = `slot-${input.variant.slot}-${input.variant.slug}-${suffix}.png`;

  await mkdir(directory, { recursive: true });
  await copyFile(projectPath(projectRoot, input.variant.filePath), path.join(directory, file));
  const savedOrig = await copyIfPresent(
    input.variant.origPath === undefined
      ? undefined
      : projectPath(projectRoot, input.variant.origPath),
    path.join(directory, orig),
  );
  const savedLog = await copyIfPresent(
    input.variant.editLogPath === undefined
      ? undefined
      : projectPath(projectRoot, input.variant.editLogPath),
    path.join(directory, editLog),
  );
  const savedScreenshot = await copyIfPresent(
    input.variant.screenshotPath === undefined
      ? undefined
      : projectPath(projectRoot, input.variant.screenshotPath),
    path.join(directory, screenshot),
  );
  const snapshot: RoundVariantSnapshot = {
    id,
    slot: input.variant.slot,
    role: input.variant.role,
    slug: input.variant.slug,
    name: input.variant.name,
    rationale: input.variant.rationale,
    file,
    orig: savedOrig,
    editLog: savedLog,
    screenshot: savedScreenshot,
    current: true,
    createdAt: new Date().toISOString(),
  };

  round.variants = round.variants
    .map((existing) =>
      existing.slot === input.variant.slot ? { ...existing, current: false } : existing,
    )
    .concat(snapshot);
  await writeRound(projectRoot, round);

  return snapshot;
}

function screenshotPathFor(
  projectRoot: string,
  state: BoardState,
  slug: string,
): string | undefined {
  const variant = state.variants.find((candidate) => candidate.slug === slug);

  return variant?.screenshotPath === undefined
    ? undefined
    : projectPath(projectRoot, variant.screenshotPath);
}

export async function restoreRoundVariant(
  projectRoot: string,
  input: RestoreRoundInput,
): Promise<{
  replaced: RoundVariantSnapshot | null;
  snapshot: RoundVariantSnapshot;
  state: BoardState;
}> {
  const round = await readRound(projectRoot, input.round);

  if (round === null) {
    throw new Error(`Round ${input.round} was not found.`);
  }

  const snapshot = round.variants.find((candidate) => candidate.id === input.snapshotId);

  if (snapshot === undefined) {
    throw new Error(`Snapshot ${input.snapshotId} was not found in round ${input.round}.`);
  }

  const state = await readBoardState(projectRoot);
  const current = state.variants.find((candidate) => candidate.slot === snapshot.slot);
  const replaced: RoundVariantSnapshot | null = null;

  if (current !== undefined) {
    await saveRoundSnapshot(projectRoot, {
      number: state.round,
      scope: input.scope,
      variant: {
        editLogPath: path.join(projectRoot, ".fittingroom", "edits", `${current.slug}.json`),
        filePath: projectPath(
          projectRoot,
          current.filePath ?? `.fittingroom/variants/${current.slug}.tsx`,
        ),
        name: current.name,
        origPath: path.join(projectRoot, ".fittingroom", "variants", `${current.slug}.orig.tsx`),
        rationale: current.rationale,
        role: snapshot.role,
        ...(screenshotPathFor(projectRoot, state, current.slug) === undefined
          ? {}
          : { screenshotPath: screenshotPathFor(projectRoot, state, current.slug) }),
        slug: current.slug,
        slot: current.slot,
      },
    });
  }

  const currentPath =
    current?.filePath === undefined
      ? path.join(projectRoot, ".fittingroom", "variants", `${snapshot.slug}.tsx`)
      : projectPath(projectRoot, current.filePath);

  await mkdir(path.dirname(currentPath), { recursive: true });
  await copyFile(path.join(roundDirectory(projectRoot, round.number), snapshot.file), currentPath);
  const origTarget = path.join(
    projectRoot,
    ".fittingroom",
    "variants",
    `${current?.slug ?? snapshot.slug}.orig.tsx`,
  );
  const logTarget = path.join(
    projectRoot,
    ".fittingroom",
    "edits",
    `${current?.slug ?? snapshot.slug}.json`,
  );

  if (snapshot.orig === null) {
    await rm(origTarget, { force: true });
  } else {
    await mkdir(path.dirname(origTarget), { recursive: true });
    await copyFile(path.join(roundDirectory(projectRoot, round.number), snapshot.orig), origTarget);
  }

  if (snapshot.editLog === null) {
    await rm(logTarget, { force: true });
  } else {
    await mkdir(path.dirname(logTarget), { recursive: true });
    await copyFile(
      path.join(roundDirectory(projectRoot, round.number), snapshot.editLog),
      logTarget,
    );
  }

  const restoredScreenshot = screenshotPathFor(projectRoot, state, current?.slug ?? snapshot.slug);
  const nextVariant = {
    slug: current?.slug ?? snapshot.slug,
    name: snapshot.name,
    rationale: snapshot.rationale,
    slot: snapshot.slot,
    pinned: current?.pinned ?? false,
    role: snapshot.role,
    filePath: current?.filePath ?? `.fittingroom/variants/${snapshot.slug}.tsx`,
    ...(restoredScreenshot === undefined ? {} : { screenshotPath: restoredScreenshot }),
  };
  const variants = state.variants
    .filter((candidate) => candidate.slot !== snapshot.slot)
    .concat(nextVariant)
    .sort((first, second) => first.slot - second.slot);
  const nextState: BoardState = {
    ...state,
    status: "directions_ready",
    approved: null,
    selected: null,
    variants,
  };

  await writeBoardState(projectRoot, nextState);
  await saveRoundSnapshot(projectRoot, {
    number: state.round,
    scope: input.scope,
    variant: {
      editLogPath: logTarget,
      filePath: currentPath,
      name: snapshot.name,
      origPath: origTarget,
      rationale: snapshot.rationale,
      role: snapshot.role,
      ...(screenshotPathFor(projectRoot, nextState, nextVariant.slug) === undefined
        ? {}
        : { screenshotPath: screenshotPathFor(projectRoot, nextState, nextVariant.slug) }),
      slug: nextVariant.slug,
      slot: nextVariant.slot,
    },
  });

  const history = await readRegenerationHistory(projectRoot);
  const session = history.scopes[input.scope.id];

  if (session !== undefined && snapshot.slug !== "refined") {
    if (!session.seenDirections.includes(snapshot.slug)) {
      session.seenDirections.push(snapshot.slug);
      history.scopes[input.scope.id] = session;
      await writeRegenerationHistory(projectRoot, history);
    }
  }

  return { replaced, snapshot, state: nextState };
}
