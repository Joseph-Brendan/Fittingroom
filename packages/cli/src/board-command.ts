import path from "node:path";
import {
  applyStructureAction,
  applyVariantEdit,
  detectDesignSystem,
  type EditOperation,
  extractStructure,
  findScope,
  listRounds,
  loadFittingRoomFile,
  loadJsonFile,
  loadScopes,
  parseBoardState,
  type RefinedMode,
  type RegeneratedSlot,
  type RegenerationSession,
  readBoardState,
  readLiveBoardLock,
  readRegenerationHistory,
  readStructure,
  redoVariantEdit,
  restoreRoundVariant,
  saveRoundSnapshot,
  undoVariantEdit,
  type VariantRole,
  writeStructure,
} from "@fittingroom/core";
import {
  type DesignDirection,
  type DirectionSurface,
  directionLibrary,
  getDirection,
} from "@fittingroom/directions";
import { previewVariant } from "@fittingroom/mcp";
import {
  type BoardFinding,
  type BoardState,
  type BoardVariant,
  type RunningBoardServer,
  startBoardServer,
} from "./board-server.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoardFileState(value: unknown): BoardState {
  if (!isRecord(value)) {
    throw new Error("The board state must be an object.");
  }

  return parseBoardState(value);
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
  projectRoot?: string;
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

  const variants = round.slots.map((slot) => ({
    slug: slot.directionSlug ?? "refined",
    name: slot.name,
    rationale: slot.rationale,
    slot: slot.slot,
    pinned: session.pinnedSlots.includes(slot.slot),
    ...(slot.mode === undefined ? {} : { mode: slot.mode }),
  }));

  return {
    version: 2,
    scope: { id: session.scopeId, name: session.scopeName },
    surface: session.surface,
    round: session.rounds.length,
    status: variants.length === 0 ? "empty" : "directions_ready",
    selected: null,
    approved: null,
    findings,
    variants,
    previousRounds: session.rounds.slice(0, -1).map((previous) => ({
      id: previous.id,
      createdAt: previous.createdAt,
      variants: previous.slots.map((slot) => ({
        slot: slot.slot,
        name: slot.name,
        slug: slot.directionSlug ?? "refined",
      })),
    })),
  };
}

export async function runBoardCommand(
  options: BoardCommandOptions = {},
): Promise<RunningBoardServer> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const output = options.output ?? process.stdout;
  const live = await readLiveBoardLock(projectRoot);

  if (live !== null) {
    const server = await startBoardServer({ projectRoot });

    output.write(`Board ready: ${server.url}\n`);
    return server;
  }

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

  const defaultBoardState = async (): Promise<BoardState> => {
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
      version: 2,
      scope: { id: selected.id, name: selected.name },
      scopes: loaded.scopes.map((scope) => ({ id: scope.id, name: scope.name })),
      round: 0,
      status: "empty",
      variants: [],
      findings: [],
      previousRounds: [],
      selected: null,
      approved: null,
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
  const session = history.scopes[initial.scope.id] ?? initialSession(initial);
  const seeded = stateFromSession(session, initial.findings);
  const base: BoardState =
    initial.variants.length === 0 && seeded.variants.length > 0
      ? {
          ...initial,
          variants: seeded.variants,
          previousRounds: seeded.previousRounds,
          round: seeded.round,
          status: seeded.status,
        }
      : initial;
  const variantFile = (state: BoardState, slug: string): string => {
    const variant = state.variants.find((candidate) => candidate.slug === slug);

    if (variant?.filePath === undefined) {
      throw new Error(
        `Variant ${slug} has no editable file. Register it again from fr_register_variant.`,
      );
    }

    return path.resolve(projectRoot, variant.filePath);
  };
  const rebuildPreview = async (filePath: string, slug: string): Promise<void> => {
    await previewVariant(projectRoot, filePath, slug);
  };
  const saveCurrentSnapshot = async (
    state: BoardState,
    slug: string,
    filePath: string,
  ): Promise<void> => {
    const variant = state.variants.find((candidate) => candidate.slug === slug);
    const role = variant?.role ?? (variant === undefined ? undefined : roles[variant.slot]);

    if (variant === undefined || role === undefined) {
      return;
    }

    await saveRoundSnapshot(projectRoot, {
      number: state.round,
      scope: state.scope,
      variant: {
        editLogPath: path.join(projectRoot, ".fittingroom", "edits", `${slug}.json`),
        filePath,
        name: variant.name,
        origPath: path.join(projectRoot, ".fittingroom", "variants", `${slug}.orig.tsx`),
        rationale: variant.rationale,
        role,
        screenshotPath: path.join(projectRoot, ".fittingroom", "variants", slug, "preview.png"),
        slug,
        slot: variant.slot,
      },
    });
  };
  const server = await startBoardServer({
    projectRoot,
    state: withBoardExtras(base, {
      designSystem: initial.designSystem,
      scopes: initial.scopes,
    }),
    ...(previews === undefined ? {} : { previews }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.token === undefined ? {} : { token: options.token }),
    edit: async ({ state, slug, operation }) => {
      const filePath = variantFile(state, slug);

      await applyVariantEdit(filePath, operation as unknown as EditOperation, {
        projectRoot,
        slug,
      });
      await rebuildPreview(filePath, slug);
      await saveCurrentSnapshot(state, slug, filePath);

      return { state };
    },
    undo: async ({ state, slug }) => {
      const filePath = variantFile(state, slug);

      await undoVariantEdit(filePath, { projectRoot, slug });
      await rebuildPreview(filePath, slug);
      await saveCurrentSnapshot(state, slug, filePath);

      return { state };
    },
    redo: async ({ state, slug }) => {
      const filePath = variantFile(state, slug);

      await redoVariantEdit(filePath, { projectRoot, slug });
      await rebuildPreview(filePath, slug);
      await saveCurrentSnapshot(state, slug, filePath);

      return { state };
    },
    rounds: async () => listRounds(projectRoot),
    structure: async () => {
      const existing = await readStructure(projectRoot);

      if (existing !== null) {
        return existing;
      }

      const state = await readBoardState(projectRoot);
      const variant = state.variants[0];

      if (variant?.filePath === undefined) {
        return null;
      }

      const extracted = await extractStructure({
        filePath: path.resolve(projectRoot, variant.filePath),
        page: state.page ?? "/",
        scope: state.scope.id,
      });

      await writeStructure(projectRoot, extracted);

      return extracted;
    },
    structureAction: async ({ action, slug, state }) => {
      const filePath = variantFile(state, slug);

      await applyStructureAction({
        action,
        filePath,
        page: state.page ?? "/",
        projectRoot,
        scope: state.scope.id,
        slug,
      });
      await rebuildPreview(filePath, slug);
      await saveCurrentSnapshot(state, slug, filePath);

      return state;
    },
    restore: async ({ round, snapshotId, state }) => {
      const result = await restoreRoundVariant(projectRoot, {
        round,
        scope: state.scope,
        snapshotId,
      });
      const variant = result.state.variants.find(
        (candidate) => candidate.slot === result.snapshot.slot,
      );

      if (variant?.filePath !== undefined) {
        await rebuildPreview(path.resolve(projectRoot, variant.filePath), variant.slug);
      }

      return result.state;
    },
  });

  output.write(`Board ready: ${server.url}\n`);

  if (options.appUrl !== undefined) {
    output.write(`App URL: ${options.appUrl}\n`);
  }

  return server;
}
