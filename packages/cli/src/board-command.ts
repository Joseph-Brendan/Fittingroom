import path from "node:path";
import {
  detectDesignSystem,
  findScope,
  loadFittingRoomFile,
  loadJsonFile,
  loadScopes,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoardFileState(value: unknown): BoardFileState {
  if (!isRecord(value)) {
    throw new Error("The board state must be an object.");
  }

  if (
    !isRecord(value.scope) ||
    typeof value.scope.id !== "string" ||
    typeof value.scope.name !== "string"
  ) {
    throw new Error("The board state needs a scope with an id and name.");
  }

  if (!Array.isArray(value.variants)) {
    throw new Error("The board state needs a variants array.");
  }

  if (!Array.isArray(value.findings)) {
    throw new Error("The board state needs a findings array.");
  }

  if (value.previousRounds !== undefined && !Array.isArray(value.previousRounds)) {
    throw new Error("The board state previousRounds must be an array.");
  }

  if (
    value.scopes !== undefined &&
    (!Array.isArray(value.scopes) ||
      value.scopes.some(
        (scope) =>
          !isRecord(scope) || typeof scope.id !== "string" || typeof scope.name !== "string",
      ))
  ) {
    throw new Error("The board state scopes must be an array of page groups.");
  }

  if (value.previews !== undefined && !isRecord(value.previews)) {
    throw new Error("The board state previews must be an object.");
  }

  if (value.designSystem !== undefined && !isRecord(value.designSystem)) {
    throw new Error("The board state designSystem must be an object.");
  }

  return value as unknown as BoardFileState;
}

function designSystemSummary(info: Awaited<ReturnType<typeof detectDesignSystem>>): string {
  const labels: Record<string, string> = {
    "tailwind-v4": "Tailwind v4 @theme",
    "tailwind-v3": "Tailwind v3 config",
    dtcg: "DTCG tokens",
    "css-variables": "CSS variables",
    shadcn: "shadcn/ui",
    mui: "MUI",
    chakra: "Chakra UI",
    mantine: "Mantine",
    "radix-themes": "Radix Themes",
    "ant-design": "Ant Design",
  };
  const sources = info.sources.map((source) => labels[source] ?? source).join(", ");

  if (info.status === "connected") {
    return `Design system connected: ${sources}.`;
  }

  if (info.status === "partial") {
    return `Design system partly found: ${sources}. Missing ${info.missing.join(", ")}.`;
  }

  return "Design system not found. Edits will create a new token set you can adopt later.";
}

function withBoardExtras(
  state: BoardState,
  extras: {
    designSystem?: BoardState["designSystem"] | undefined;
    scopes?: BoardState["scopes"] | undefined;
  },
): BoardState {
  return {
    ...state,
    ...(extras.designSystem === undefined ? {} : { designSystem: extras.designSystem }),
    ...(extras.scopes === undefined ? {} : { scopes: extras.scopes }),
  };
}

export interface BoardCommandOptions {
  appUrl?: string;
  output?: NodeJS.WritableStream;
  port?: number;
  scope?: string;
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
  const fallbackOptions = options.appUrl === undefined ? {} : { fallbackUrl: options.appUrl };
  let config: Awaited<ReturnType<typeof loadScopes>> | undefined;
  let requestedScope: { id: string; name: string } | undefined;

  if (options.scope !== undefined) {
    config = await loadScopes(projectRoot, fallbackOptions);

    const found = findScope(config, options.scope);

    if (found === undefined) {
      throw new Error(`Unknown scope ${options.scope}. Run fitroom scopes to list groups.`);
    }

    requestedScope = { id: found.id, name: found.name };
  }

  const loadConfig = async (): Promise<Awaited<ReturnType<typeof loadScopes>>> => {
    if (config === undefined) {
      config = await loadScopes(projectRoot, fallbackOptions);
    }

    return config;
  };

  const defaultBoardState = async (): Promise<BoardFileState> => {
    const loaded = await loadConfig();
    const selected =
      options.scope === undefined ? loaded.scopes[0] : findScope(loaded, options.scope);

    if (options.scope !== undefined && selected === undefined) {
      throw new Error(`Unknown scope ${options.scope}. Run fitroom scopes to list groups.`);
    }

    if (selected === undefined) {
      throw new Error("No page groups found. Add an app folder or run with --url.");
    }

    return {
      scope: { id: selected.id, name: selected.name },
      scopes: loaded.scopes.map((scope) => ({ id: scope.id, name: scope.name })),
      variants: [],
      findings: [],
      previousRounds: [],
    };
  };

  const raw =
    options.statePath === undefined
      ? await loadFittingRoomFile({
          projectRoot,
          fileName: "board.json",
          schema: parseBoardFileState,
          defaultValue: defaultBoardState,
        })
      : await loadJsonFile({
          filePath: path.resolve(options.statePath),
          schema: parseBoardFileState,
          defaultValue: defaultBoardState,
        });
  const { previews, ...initialState } = raw;
  const scopes = initialState.scopes ??
    config?.scopes.map((scope) => ({ id: scope.id, name: scope.name })) ?? [
      { id: initialState.scope.id, name: initialState.scope.name },
    ];
  const detectedDesignSystem =
    initialState.designSystem === undefined ? await detectDesignSystem(projectRoot) : undefined;
  const designSystem: BoardState["designSystem"] =
    initialState.designSystem ??
    (detectedDesignSystem === undefined
      ? undefined
      : {
          status: detectedDesignSystem.status,
          summary: designSystemSummary(detectedDesignSystem),
          tokens: detectedDesignSystem.tokens,
          components: detectedDesignSystem.components,
        });
  const initial: BoardState = {
    ...initialState,
    ...(requestedScope === undefined ? {} : { scope: requestedScope }),
    ...(designSystem === undefined ? {} : { designSystem }),
    scopes,
    previousRounds: initialState.previousRounds ?? [],
  };
  const history = await readRegenerationHistory(projectRoot);
  let session = history.scopes[initial.scope.id] ?? initialSession(initial);

  history.scopes[session.scopeId] = session;

  const output = options.output ?? process.stdout;
  const server = await startBoardServer({
    state: withBoardExtras(stateFromSession(session, initial.findings), {
      designSystem: initial.designSystem,
      scopes: initial.scopes,
    }),
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

      return withBoardExtras(stateFromSession(session, state.findings), {
        designSystem: state.designSystem,
        scopes: state.scopes,
      });
    },
    pin: async ({ state, slot, pinned }) => {
      setSessionPinned(session, slot, pinned);
      history.scopes[session.scopeId] = session;
      await writeRegenerationHistory(projectRoot, history);

      return withBoardExtras(stateFromSession(session, state.findings), {
        designSystem: state.designSystem,
        scopes: state.scopes,
      });
    },
  });

  output.write(`Board ready: ${server.url}\n`);

  if (options.appUrl !== undefined) {
    output.write(`App URL: ${options.appUrl}\n`);
  }

  return server;
}
