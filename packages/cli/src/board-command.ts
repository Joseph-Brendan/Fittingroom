import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type RefinedMode,
  type RegeneratedSlot,
  type RegenerationSession,
  readRegenerationHistory,
  regenerateSession,
  setSessionPinned,
  type VariantRole,
  writeRegenerationHistory,
} from "@fittingroom/core";
import {
  type DesignDirection,
  type DirectionSurface,
  directionLibrary,
  getDirection,
} from "@fittingroom/directions";
import {
  type BoardFinding,
  type BoardState,
  type BoardVariant,
  type RunningBoardServer,
  startBoardServer,
} from "./board-server.js";

interface BoardFileState extends BoardState {
  previews?: Record<string, string>;
}

export interface BoardCommandOptions {
  output?: NodeJS.WritableStream;
  port?: number;
  statePath?: string;
  token?: string;
}

const roles: Record<number, VariantRole> = {
  1: "refined",
  2: "native",
  3: "bold",
  4: "wildcard",
};

function slotDirection(
  variant: BoardVariant,
  surface: DirectionSurface,
):
  | DesignDirection
  | {
      slug: "refined";
      name: "Refined";
      surfaces: DirectionSurface[];
      description: string;
      modes: RefinedMode[];
    } {
  if (variant.slot === 1) {
    return {
      slug: "refined",
      name: "Refined",
      surfaces: [surface],
      description:
        "Keep the current layout, brand colors, fonts and style while improving fixes and hierarchy.",
      modes: ["light", "deep"],
    };
  }

  const direction = getDirection(variant.slug);

  if (direction !== undefined) {
    return direction;
  }

  const fallback = directionLibrary.find((entry) => entry.surfaces.includes(surface));

  if (fallback === undefined) {
    throw new Error(`No fallback direction exists for ${surface}.`);
  }

  return fallback;
}

function initialSession(state: BoardState): RegenerationSession {
  const surface = state.surface ?? "app";
  const pinnedSlots = state.variants
    .filter((variant) => variant.pinned)
    .map((variant) => variant.slot)
    .filter((slot) => slot === 1 || slot === 2 || slot === 3 || slot === 4);
  const slots: RegeneratedSlot[] = state.variants.map((variant) => {
    const slot =
      variant.slot === 1 || variant.slot === 2 || variant.slot === 3 || variant.slot === 4
        ? variant.slot
        : 1;

    return {
      slot,
      role: roles[slot] ?? "refined",
      directionSlug: slot === 1 ? null : variant.slug,
      direction: slotDirection(variant, surface),
      name: variant.name,
      rationale: variant.rationale,
      ...(slot === 1 ? { mode: variant.mode ?? "light" } : {}),
      screenshotPaths: [],
    };
  });

  return {
    scopeId: state.scope.id,
    scopeName: state.scope.name,
    surface,
    pinnedSlots,
    rounds: [
      {
        id: "initial",
        createdAt: new Date().toISOString(),
        mode: "light",
        slots,
      },
    ],
    seenDirections: state.variants
      .filter((variant) => variant.slot !== 1)
      .map((variant) => variant.slug),
    baselineScreenshots: [],
  };
}

function stateFromSession(session: RegenerationSession, findings: BoardFinding[]): BoardState {
  const round = session.rounds.at(-1);

  if (round === undefined) {
    throw new Error("No board round exists.");
  }

  return {
    scope: { id: session.scopeId, name: session.scopeName },
    surface: session.surface,
    findings,
    variants: round.slots.map((slot) => ({
      slug: slot.directionSlug ?? "refined",
      name: slot.name,
      rationale: slot.rationale,
      slot: slot.slot,
      pinned: session.pinnedSlots.includes(slot.slot),
      ...(slot.mode === undefined ? {} : { mode: slot.mode }),
    })),
    previousRounds: session.rounds.slice(0, -1).map((previous) => ({
      id: previous.id,
      createdAt: previous.createdAt,
      variants: previous.slots.map((slot) => ({ slot: slot.slot, name: slot.name })),
    })),
  };
}

export async function runBoardCommand(
  options: BoardCommandOptions = {},
): Promise<RunningBoardServer> {
  const projectRoot = process.cwd();
  const statePath = options.statePath ?? path.resolve(projectRoot, ".fittingroom", "board.json");
  const raw = JSON.parse(await readFile(statePath, "utf8")) as BoardFileState;
  const { previews, ...initialState } = raw;

  if (
    typeof initialState.scope?.id !== "string" ||
    !Array.isArray(initialState.variants) ||
    !Array.isArray(initialState.findings)
  ) {
    throw new Error("Board state needs a scope, variants and findings.");
  }

  const initial = {
    ...initialState,
    previousRounds: initialState.previousRounds ?? [],
  };
  const history = await readRegenerationHistory(projectRoot);
  let session = history.scopes[initial.scope.id] ?? initialSession(initial);

  history.scopes[session.scopeId] = session;

  const output = options.output ?? process.stdout;
  const server = await startBoardServer({
    state: stateFromSession(session, initial.findings),
    ...(previews === undefined ? {} : { previews }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.token === undefined ? {} : { token: options.token }),
    regenerate: async ({ state, slots, mode }) => {
      const result = await regenerateSession(
        session,
        {
          ...(slots === undefined ? {} : { slots }),
          ...(mode === undefined ? {} : { mode }),
        },
        path.join(projectRoot, ".fittingroom", "regenerations", session.scopeId),
      );

      session = result.session;
      history.scopes[session.scopeId] = session;
      await writeRegenerationHistory(projectRoot, history);

      return stateFromSession(session, state.findings);
    },
    pin: async ({ state, slot, pinned }) => {
      setSessionPinned(session, slot, pinned);
      history.scopes[session.scopeId] = session;
      await writeRegenerationHistory(projectRoot, history);

      return stateFromSession(session, state.findings);
    },
  });

  output.write(`Board ready: ${server.url}\n`);

  return server;
}
