import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type DesignDirection,
  type DirectionSurface,
  directionLibrary,
  getDirection,
} from "@fittingroom/directions";

export type RefinedMode = "light" | "deep";
export type VariantRole = "refined" | "native" | "bold" | "wildcard";
export type VariantSlotNumber = 1 | 2 | 3 | 4;

export interface RefinedDirectionSpec {
  slug: "refined";
  name: "Refined";
  surfaces: DirectionSurface[];
  description: string;
  modes: RefinedMode[];
}

export interface RegeneratedSlot {
  slot: VariantSlotNumber;
  role: VariantRole;
  directionSlug: string | null;
  direction: DesignDirection | RefinedDirectionSpec;
  name: string;
  rationale: string;
  mode?: RefinedMode;
  screenshotPaths: string[];
}

export interface RegenerationRound {
  id: string;
  createdAt: string;
  mode: RefinedMode;
  slots: RegeneratedSlot[];
}

export interface RegenerationSession {
  scopeId: string;
  scopeName: string;
  surface: DirectionSurface;
  pinnedSlots: VariantSlotNumber[];
  rounds: RegenerationRound[];
  seenDirections: string[];
  baselineScreenshots: Array<{ width: number; path: string }>;
}

export interface RegenerationHistory {
  version: 1;
  scopes: Record<string, RegenerationSession>;
}

export interface RegenerateOptions {
  mode?: RefinedMode;
  slots?: readonly number[];
}

export interface RegenerationResult {
  session: RegenerationSession;
  round: RegenerationRound;
  changedSlots: VariantSlotNumber[];
}

export interface RegenerateScopeInput extends RegenerateOptions {
  baselineScreenshots?: Array<{ width: number; path: string }>;
  projectRoot: string;
  scopeId: string;
  scopeName: string;
  surface: DirectionSurface;
}

const slotRoles: Record<VariantSlotNumber, VariantRole> = {
  1: "refined",
  2: "native",
  3: "bold",
  4: "wildcard",
};

const preferredDirections: Record<
  DirectionSurface,
  Record<Exclude<VariantRole, "refined">, string[]>
> = {
  app: {
    native: [
      "clean-ui",
      "material-3",
      "apple-native",
      "fluent",
      "card-based",
      "high-contrast-inclusive",
      "dark-first",
      "ai-native",
      "spatial",
      "terminal-cli",
      "soft-ui-neumorphism",
    ],
    bold: [
      "dark-first",
      "terminal-cli",
      "high-contrast-inclusive",
      "ai-native",
      "spatial",
      "clean-ui",
      "material-3",
      "fluent",
      "card-based",
      "apple-native",
      "soft-ui-neumorphism",
    ],
    wildcard: [
      "spatial",
      "soft-ui-neumorphism",
      "terminal-cli",
      "ai-native",
      "dark-first",
      "high-contrast-inclusive",
      "clean-ui",
      "material-3",
      "fluent",
      "card-based",
      "apple-native",
    ],
  },
  marketing: {
    native: [
      "swiss-international",
      "editorial",
      "type-first",
      "bento-grid",
      "monochrome",
      "biophilic",
      "glass",
      "aurora-mesh",
      "organic-blob",
      "art-deco",
      "bauhaus",
      "claymorphism",
      "scrapbook-hand-drawn",
      "neubrutalism",
      "dopamine",
      "memphis",
      "cyberpunk",
      "retro-y2k",
    ],
    bold: [
      "neubrutalism",
      "memphis",
      "dopamine",
      "cyberpunk",
      "bauhaus",
      "type-first",
      "art-deco",
      "retro-y2k",
      "scrapbook-hand-drawn",
      "claymorphism",
      "aurora-mesh",
      "glass",
      "bento-grid",
      "organic-blob",
      "biophilic",
      "monochrome",
      "editorial",
      "swiss-international",
    ],
    wildcard: [
      "scrapbook-hand-drawn",
      "claymorphism",
      "retro-y2k",
      "art-deco",
      "memphis",
      "dopamine",
      "cyberpunk",
      "bauhaus",
      "aurora-mesh",
      "glass",
      "bento-grid",
      "organic-blob",
      "biophilic",
      "monochrome",
      "editorial",
      "type-first",
      "neubrutalism",
      "swiss-international",
    ],
  },
  dashboard: {
    native: [
      "data-dense-utilitarian",
      "executive-minimal",
      "analytical",
      "calm-monochrome-accent",
      "operational",
      "widget-bento-dashboard",
      "command-center",
    ],
    bold: [
      "command-center",
      "operational",
      "widget-bento-dashboard",
      "analytical",
      "data-dense-utilitarian",
      "executive-minimal",
      "calm-monochrome-accent",
    ],
    wildcard: [
      "widget-bento-dashboard",
      "operational",
      "analytical",
      "command-center",
      "calm-monochrome-accent",
      "data-dense-utilitarian",
      "executive-minimal",
    ],
  },
};

function surfaceDirections(surface: DirectionSurface): string[] {
  return directionLibrary
    .filter((direction) => direction.surfaces.includes(surface))
    .map((direction) => direction.slug);
}

function candidatesFor(surface: DirectionSurface, role: Exclude<VariantRole, "refined">): string[] {
  const available = surfaceDirections(surface);
  const preferred = preferredDirections[surface][role].filter((slug) => available.includes(slug));

  return [...new Set([...preferred, ...available])];
}

function pickDirection(
  surface: DirectionSurface,
  role: Exclude<VariantRole, "refined">,
  seen: Set<string>,
  usedThisRound: Set<string>,
): string {
  const candidates = candidatesFor(surface, role);
  let open = candidates.filter((slug) => !seen.has(slug) && !usedThisRound.has(slug));

  if (open.length === 0) {
    seen.clear();
    open = candidates.filter((slug) => !usedThisRound.has(slug));
  }

  const selected = open[0];

  if (selected === undefined) {
    throw new Error(`No directions are available for the ${surface} surface.`);
  }

  seen.add(selected);
  usedThisRound.add(selected);

  return selected;
}

function refinedDirection(surface: DirectionSurface): RefinedDirectionSpec {
  return {
    slug: "refined",
    name: "Refined",
    surfaces: [surface],
    description:
      "Keep the user's layout, brand colors, fonts and style. Improve only fixes, spacing, type scale and hierarchy.",
    modes: ["light", "deep"],
  };
}

function requestedSlots(slots: readonly number[] | undefined): VariantSlotNumber[] {
  if (slots === undefined) {
    return [1, 2, 3, 4];
  }

  const valid = slots
    .filter(
      (slot): slot is VariantSlotNumber => slot === 1 || slot === 2 || slot === 3 || slot === 4,
    )
    .filter((slot, index, all) => all.indexOf(slot) === index);

  if (valid.length === 0) {
    throw new Error("Pick at least one slot from 1 to 4.");
  }

  return valid;
}

async function copyRefinedScreenshots(
  roundDirectory: string,
  screenshots: Array<{ width: number; path: string }>,
): Promise<string[]> {
  if (screenshots.length === 0) {
    return [];
  }

  await mkdir(roundDirectory, { recursive: true });

  const paths: string[] = [];

  for (const screenshot of screenshots) {
    const target = path.join(roundDirectory, `slot-1-${screenshot.width}.png`);

    try {
      await copyFile(screenshot.path, target);
      paths.push(target);
    } catch {}
  }

  return paths;
}

export async function regenerateSession(
  session: RegenerationSession,
  options: RegenerateOptions,
  screenshotDirectory: string,
): Promise<RegenerationResult> {
  const currentRound = session.rounds.at(-1);
  const requested = requestedSlots(options.slots);
  const pinned = new Set(session.pinnedSlots);
  const mode = options.mode ?? currentRound?.mode ?? "light";
  const roundId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const seen = new Set(session.seenDirections);
  const usedThisRound = new Set<string>();
  const nextSlots: RegeneratedSlot[] = [];
  const changedSlots: VariantSlotNumber[] = [];

  for (const slotNumber of [1, 2, 3, 4] as const) {
    const currentSlot = currentRound?.slots.find((slot) => slot.slot === slotNumber);
    const shouldRegenerate =
      currentRound === undefined || (requested.includes(slotNumber) && !pinned.has(slotNumber));

    if (!shouldRegenerate && currentSlot !== undefined) {
      if (currentSlot.directionSlug !== null) {
        seen.add(currentSlot.directionSlug);
        usedThisRound.add(currentSlot.directionSlug);
      }

      nextSlots.push(currentSlot);
      continue;
    }

    changedSlots.push(slotNumber);

    if (slotNumber === 1) {
      nextSlots.push({
        slot: 1,
        role: "refined",
        directionSlug: null,
        direction: refinedDirection(session.surface),
        name: "Refined",
        rationale:
          mode === "deep"
            ? "Keeps the current style while fixing audit findings and polishing spacing, type scale and hierarchy."
            : "Keeps the current style while fixing audit findings.",
        mode,
        screenshotPaths: await copyRefinedScreenshots(
          path.join(screenshotDirectory, roundId),
          session.baselineScreenshots,
        ),
      });
      continue;
    }

    const role = slotRoles[slotNumber];

    if (role === "refined") {
      continue;
    }

    const directionSlug = pickDirection(session.surface, role, seen, usedThisRound);
    const direction = getDirection(directionSlug);

    if (direction === undefined) {
      throw new Error(`Direction ${directionSlug} is missing from the library.`);
    }

    nextSlots.push({
      slot: slotNumber,
      role,
      directionSlug,
      direction,
      name: direction.name,
      rationale: `${direction.name} fits the ${session.surface} surface for the ${role} slot.`,
      screenshotPaths: [],
    });
  }

  if (changedSlots.length === 0 && currentRound !== undefined) {
    return { session, round: currentRound, changedSlots };
  }

  session.seenDirections = [...seen];

  const round: RegenerationRound = {
    id: roundId,
    createdAt: new Date().toISOString(),
    mode,
    slots: nextSlots,
  };

  session.rounds.push(round);

  return { session, round, changedSlots };
}

export function setSessionPinned(
  session: RegenerationSession,
  slot: number,
  pinned: boolean,
): RegenerationSession {
  if (slot !== 1 && slot !== 2 && slot !== 3 && slot !== 4) {
    throw new Error("Pick a slot from 1 to 4.");
  }

  const slotNumber = slot as VariantSlotNumber;
  const pins = new Set(session.pinnedSlots);

  if (pinned) {
    pins.add(slotNumber);
  } else {
    pins.delete(slotNumber);
  }

  session.pinnedSlots = [...pins].sort();

  return session;
}

export function historyPath(projectRoot: string): string {
  return path.join(projectRoot, ".fittingroom", "history.json");
}

export async function readRegenerationHistory(projectRoot: string): Promise<RegenerationHistory> {
  try {
    const raw = JSON.parse(await readFile(historyPath(projectRoot), "utf8")) as unknown;

    if (
      typeof raw === "object" &&
      raw !== null &&
      "version" in raw &&
      raw.version === 1 &&
      "scopes" in raw &&
      typeof raw.scopes === "object" &&
      raw.scopes !== null
    ) {
      return raw as RegenerationHistory;
    }
  } catch {
    return { version: 1, scopes: {} };
  }

  return { version: 1, scopes: {} };
}

export async function writeRegenerationHistory(
  projectRoot: string,
  history: RegenerationHistory,
): Promise<void> {
  await mkdir(path.dirname(historyPath(projectRoot)), { recursive: true });
  await writeFile(historyPath(projectRoot), `${JSON.stringify(history, null, 2)}\n`);
}

export async function regenerateScope(input: RegenerateScopeInput): Promise<RegenerationResult> {
  const history = await readRegenerationHistory(input.projectRoot);
  const existing = history.scopes[input.scopeId];
  const session: RegenerationSession = existing ?? {
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    surface: input.surface,
    pinnedSlots: [],
    rounds: [],
    seenDirections: [],
    baselineScreenshots: input.baselineScreenshots ?? [],
  };

  session.scopeName = input.scopeName;
  session.surface = input.surface;

  if (input.baselineScreenshots !== undefined) {
    session.baselineScreenshots = input.baselineScreenshots;
  }

  const result = await regenerateSession(
    session,
    input,
    path.join(input.projectRoot, ".fittingroom", "regenerations", input.scopeId),
  );

  history.scopes[input.scopeId] = result.session;
  await writeRegenerationHistory(input.projectRoot, history);

  return result;
}

export async function setPinnedSlot(
  projectRoot: string,
  scopeId: string,
  slot: number,
  pinned: boolean,
): Promise<RegenerationSession> {
  const history = await readRegenerationHistory(projectRoot);
  const session = history.scopes[scopeId];

  if (session === undefined) {
    throw new Error(`No board history exists for scope ${scopeId}.`);
  }

  setSessionPinned(session, slot, pinned);
  await writeRegenerationHistory(projectRoot, history);

  return session;
}
