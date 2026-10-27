import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { type Finding as CitationFinding, citationRegistry, validate } from "@fitroom/citations";
import {
  type AuditCheckError,
  auditDesignMemory,
  type BoardState,
  buildScopeChecklist,
  type CapturedElement,
  type CaptureResult,
  type CaptureSelection,
  capture,
  checkStates,
  completeBoardRequest,
  type DefaultScope,
  type DesignMemory,
  type DiscoveredRoute,
  detectDefaultScope,
  detectDesignSystem,
  detectProjectDevServer,
  detectSlop,
  discoverRoutes,
  discoverRoutesWithSource,
  emptyBoardState,
  ensureRound,
  findingIdForPage,
  findScope,
  findScopeForRoutes,
  groupRoutes,
  loadScopes,
  normalizePagePath,
  openBoardRequests,
  PAGE_GROUPS,
  type RegeneratedSlot,
  type RegenerationSession,
  readBoardRequests,
  readBoardState,
  readContentInventory,
  readDesignMemory,
  readLiveBoardLock,
  readRegenerationHistory,
  readStructure,
  regenerateScope,
  renderSlopScoreCard,
  runAutomatedChecks,
  type ScopeChecklistEntry,
  type ScopeSummary,
  type ScopesConfig,
  type StructureFile,
  saveDesignMemory,
  saveRoundSnapshot,
  saveVariantOriginal,
  stampVariantFile,
  updateBoardState,
  type VariantRole,
  type VariantSlotNumber,
  verifyImplementation,
  waitForBoardEvent,
  writeHandoff,
  writeRegenerationHistory,
} from "@fitroom/core";
import { type DesignDirection, type DirectionSurface, getDirection } from "@fitroom/directions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { previewVariant } from "./preview.js";
import { typecheckVariant } from "./typecheck.js";

export const fitroomServerInfo = {
  name: "fitroom",
  version: "0.0.0",
} as const;

export interface FitroomServerOptions {
  appUrl?: string;
  auditOutputDir?: string;
  boardCommand?: string[];
  boardStartTimeoutMs?: number;
  captureOutputDir?: string;
  currentPath?: string;
  projectRoot?: string;
}

type StoredFinding = CitationFinding & { page?: string };

interface CapturePayload {
  summary: ScopeSummary;
  screenshots: string[];
  pages: CaptureResult["pages"];
}

interface AuditPayload extends CapturePayload {
  critiqueBrief: string;
  errors: Array<AuditCheckError & { page: string }>;
  findings: StoredFinding[];
}

interface DirectionDesignSystem extends Awaited<ReturnType<typeof detectDesignSystem>> {
  summary: string;
}

interface DirectionSlot {
  slot: number;
  role: "refined" | "native" | "bold" | "wildcard";
  direction: DesignDirection | Record<string, unknown>;
  screenshots: CaptureResult["pages"][number]["screenshots"];
  contentInventory: Array<{ role: string; text: string }>;
  designSystem: DirectionDesignSystem;
  writingRules: string[];
}

interface RegisteredVariant {
  filePath: string;
  findingsFixed: StoredFinding[];
  rationale: string;
  reference: NonNullable<Awaited<ReturnType<typeof previewVariant>>["reference"]>;
  route: string;
  tokens: Record<string, string>;
  variantSlug: string;
}
interface RegisteredVariant {
  filePath: string;
  findingsFixed: StoredFinding[];
  rationale: string;
  reference: NonNullable<Awaited<ReturnType<typeof previewVariant>>["reference"]>;
  route: string;
  tokens: Record<string, string>;
  variantSlug: string;
}

function flattenTokens(tokens: Awaited<ReturnType<typeof detectDesignSystem>>["tokens"]) {
  const flattened: Record<string, string> = {};

  for (const [category, group] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(group)) {
      flattened[`${category}.${name}`] = value;
    }
  }

  return flattened;
}

const designSystemSourceLabels: Record<string, string> = {
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

function pixelNumbers(values: readonly string[]): number[] {
  return values.flatMap((value) => {
    const match = value.trim().match(/^(-?[\d.]+)px$/);

    return match === null ? [] : [Number(match[1])];
  });
}

function stylePixels(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const match = value.trim().match(/^(-?[\d.]+)px$/);

  return match === null ? null : Number(match[1]);
}

function stylePadding(style: Record<string, string> | undefined): string | null {
  if (style === undefined) {
    return null;
  }

  const values = [
    style["padding-top"],
    style["padding-right"],
    style["padding-bottom"],
    style["padding-left"],
  ];

  return values.every((value) => value !== undefined) ? values.join(" ") : null;
}

function elementIdForTag(source: string, tag: string): string | undefined {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*data-fr-id="([^"]+)"`));

  return match?.[1];
}

function memoryFromDirection(input: {
  buttonId?: string | undefined;
  direction: DesignDirection | undefined;
  directionName: string;
  directionSlug: string;
  inputId?: string | undefined;
  reference?:
    | {
        styles: Record<string, Record<string, string>>;
      }
    | undefined;
  structure: StructureFile | null;
  tokens: Record<string, string>;
}): DesignMemory {
  const { direction, tokens } = input;
  const referenceStyles = Object.values(input.reference?.styles ?? {});
  const referenceColors = new Set<string>();
  const referenceFonts = new Set<string>();
  const referenceSizes = new Set<number>();
  const referenceSpacing = new Set<number>();
  const referenceRadii = new Set<number>();

  for (const style of referenceStyles) {
    for (const property of [
      "color",
      "background-color",
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
    ]) {
      const value = style[property];

      if (
        value !== undefined &&
        value !== "" &&
        value !== "transparent" &&
        value !== "rgba(0, 0, 0, 0)"
      ) {
        referenceColors.add(value);
      }
    }

    const font = style["font-family"];

    if (font !== undefined && font !== "") {
      referenceFonts.add(font);
    }

    const size = stylePixels(style["font-size"]);

    if (size !== null && size > 0) {
      referenceSizes.add(size);
    }

    for (const property of [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "gap",
      "row-gap",
      "column-gap",
    ]) {
      const value = stylePixels(style[property]);

      if (value !== null && value > 0) {
        referenceSpacing.add(value);
      }
    }

    for (const property of [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-left-radius",
      "border-bottom-right-radius",
    ]) {
      const value = stylePixels(style[property]);

      if (value !== null && value > 0) {
        referenceRadii.add(value);
      }
    }
  }

  const tokenFonts = Object.entries(tokens)
    .filter(([name]) => name.startsWith("font."))
    .map(([, value]) => value);
  const tokenSizes = pixelNumbers(
    Object.entries(tokens)
      .filter(([name]) => name.startsWith("fontSize."))
      .map(([, value]) => value),
  );
  const colors: Record<string, string> = {};

  if (direction !== undefined) {
    colors.accent = direction.colorRecipe.accent;
    colors.accentText = direction.colorRecipe.accentText;
    colors.background = direction.colorRecipe.background;
    colors.border = direction.colorRecipe.border;
    colors.mutedText = direction.colorRecipe.mutedText;
    colors.surface = direction.colorRecipe.surface;
    colors.text = direction.colorRecipe.text;
  }

  for (const [name, value] of Object.entries(tokens).filter(([name]) =>
    name.startsWith("color."),
  )) {
    colors[name] = value;
  }

  let colorIndex = 1;

  for (const value of referenceColors) {
    if (!Object.values(colors).includes(value)) {
      colors[`observed-color-${colorIndex}`] = value;
      colorIndex += 1;
    }
  }

  const spacing: Record<string, string> = {};

  for (const [name, value] of Object.entries(tokens).filter(([name]) =>
    name.startsWith("space."),
  )) {
    spacing[name] = value;
  }

  let spacingIndex = 1;

  for (const value of referenceSpacing) {
    const normalized = `${value}px`;

    if (!Object.values(spacing).includes(normalized)) {
      spacing[`observed-space-${spacingIndex}`] = normalized;
      spacingIndex += 1;
    }
  }

  const radii: Record<string, string> = {};

  for (const [name, value] of Object.entries(tokens).filter(([name]) =>
    name.startsWith("radius."),
  )) {
    radii[name] = value;
  }

  let radiusIndex = 1;

  for (const value of referenceRadii) {
    const normalized = `${value}px`;

    if (!Object.values(radii).includes(normalized)) {
      radii[`observed-radius-${radiusIndex}`] = normalized;
      radiusIndex += 1;
    }
  }

  const fontList = [
    ...new Set([
      ...(direction === undefined ? [] : [direction.typePair.display, direction.typePair.body]),
      ...tokenFonts,
      ...referenceFonts,
    ]),
  ];
  const bodyFont = fontList[0] ?? "system-ui, sans-serif";
  const displayFont = direction?.typePair.display ?? bodyFont;
  const scale = [
    ...new Set([...(direction?.typeScale.steps ?? []), ...tokenSizes, ...referenceSizes]),
  ];
  const resolvedScale = scale.length === 0 ? [16, 24, 32] : scale;
  const buttonStyle =
    input.buttonId === undefined ? undefined : input.reference?.styles[input.buttonId];
  const inputStyle =
    input.inputId === undefined ? undefined : input.reference?.styles[input.inputId];
  const accent =
    buttonStyle?.["background-color"] ??
    direction?.colorRecipe.accent ??
    colors["color.accent"] ??
    "#1d4ed8";
  const accentText =
    buttonStyle?.color ??
    direction?.colorRecipe.accentText ??
    colors["color.accentText"] ??
    "#ffffff";
  const controlRadius =
    buttonStyle?.["border-top-left-radius"] ??
    direction?.radius.control ??
    Object.values(radii)[0] ??
    "6px";
  const baseSize =
    stylePixels(buttonStyle?.["font-size"]) ?? direction?.typeScale.base ?? resolvedScale[0] ?? 16;
  const buttonPadding = stylePadding(buttonStyle) ?? "12px 18px";
  const inputPadding = stylePadding(inputStyle) ?? "8px 12px";
  const doList = direction?.do ?? [
    "Use the saved design tokens.",
    "Keep one primary action per screen.",
  ];
  const dontList = direction?.dont ?? ["Do not introduce values outside the saved tokens."];
  const finalColors =
    Object.keys(colors).length === 0
      ? { accent, accentText, background: "#ffffff", text: "#111827" }
      : colors;
  const finalSpacing =
    Object.keys(spacing).length === 0 ? { lg: "24px", md: "16px", sm: "8px" } : spacing;
  const finalRadii =
    Object.keys(radii).length === 0
      ? { control: controlRadius, panel: direction?.radius.panel ?? "12px" }
      : radii;

  return {
    version: 1,
    direction: {
      slug: input.directionSlug,
      name: direction?.name ?? input.directionName,
      description: direction?.description ?? "Keeps the approved design in its current style.",
    },
    type: {
      pair: [...new Set([displayFont, bodyFont, ...fontList])],
      scale: resolvedScale,
    },
    colors: finalColors,
    spacing: finalSpacing,
    radii: finalRadii,
    density: input.structure?.density ?? "balanced",
    button: {
      backgroundColor: accent,
      borderRadius: controlRadius,
      color: accentText,
      fontFamily: buttonStyle?.["font-family"] ?? bodyFont,
      fontSize: `${stylePixels(buttonStyle?.["font-size"]) ?? baseSize}px`,
      fontWeight: buttonStyle?.["font-weight"] ?? "600",
      padding: buttonPadding,
    },
    input: {
      backgroundColor: inputStyle?.["background-color"] ?? "#ffffff",
      borderColor: inputStyle?.["border-top-color"] ?? direction?.colorRecipe.border ?? "#111827",
      borderRadius: inputStyle?.["border-top-left-radius"] ?? controlRadius,
      color: inputStyle?.color ?? direction?.colorRecipe.text ?? "#111827",
      fontFamily: inputStyle?.["font-family"] ?? bodyFont,
      fontSize: `${stylePixels(inputStyle?.["font-size"]) ?? baseSize}px`,
      padding: inputPadding,
    },
    do: doList,
    dont: dontList,
  };
}

function designSystemSummary(info: Awaited<ReturnType<typeof detectDesignSystem>>): string {
  if (info.status === "none") {
    return "Design system not found. Edits will create a new token set you can adopt later.";
  }

  const sources = info.sources
    .map((source) => designSystemSourceLabels[source] ?? source)
    .join(", ");

  if (info.status === "connected") {
    return `Design system connected: ${sources}.`;
  }

  return `Design system partly found: ${sources}. Missing ${info.missing.join(", ")}.`;
}

const writingRules = [
  "Write one file per variant.",
  "Use React and Tailwind.",
  "Use project components where they exist.",
  "Keep all real content.",
  "Do not use placeholder or lorem copy.",
];

const nativeBySurface: Record<DirectionSurface, string> = {
  app: "clean-ui",
  dashboard: "data-dense-utilitarian",
  marketing: "swiss-international",
};

const boldBySurface: Record<DirectionSurface, string> = {
  app: "dark-first",
  dashboard: "command-center",
  marketing: "neubrutalism",
};

const wildcardBySurface: Record<DirectionSurface, string> = {
  app: "spatial",
  dashboard: "widget-bento-dashboard",
  marketing: "art-deco",
};

interface ScopeState {
  currentPage: string | null;
  defaultScope: DefaultScope | null;
  scopes: ScopeChecklistEntry[];
}

interface ResolvedScopeSelection extends ScopeState {
  selection: CaptureSelection | null;
}

const scopeInputSchema = {
  pages: z.array(z.string().trim().min(1)).min(1).optional(),
  scope: z.string().trim().min(1).optional(),
};

const submittedEvidenceSchema = z.union([
  z.string().trim().min(1),
  z.object({
    measuredValue: z.string().trim().min(1),
    screenshotPath: z.string().trim().min(1),
    selector: z.string().trim().min(1),
  }),
]);

const submittedFindingSchema = z.object({
  citation: z.string().trim().min(1),
  confidence: z.literal("judged"),
  evidence: submittedEvidenceSchema,
  fix: z.string().trim().min(1),
  id: z.string().trim().min(1).optional(),
  related: z.array(z.string().trim().min(1)).optional(),
  severity: z.number().int().min(0).max(4),
  title: z.string().trim().min(1),
});

const critiqueInstructions = [
  "Review every screenshot against Nielsen's 10 heuristics.",
  "Cite only citation ids from packages/citations/registry.json. Do not invent citation ids or URLs.",
  "Rate severity on the NN/g 0 to 4 scale.",
  'Set confidence to "judged".',
  "Submit the findings with fr_submit_findings.",
].join("\n");

function textResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

async function runTool(callback: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return textResult(await callback());
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "The tool failed.");
  }
}

function normalizePath(value: string): string {
  let pathname = value;

  if (/^[a-z]+:\/\//i.test(value)) {
    pathname = new URL(value).pathname;
  }

  const withoutQuery = pathname.split(/[?#]/)[0] ?? "/";
  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;

  return prefixed.length > 1 ? prefixed.replace(/\/+$/, "") : "/";
}

function routeDirectoryName(routePath: string): string {
  if (routePath === "/") {
    return "root";
  }

  return routePath
    .replace(/^\//, "")
    .replace(/\[/g, "")
    .replace(/\]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

interface ReviewControl {
  attributes: Record<string, string>;
  selector: string;
  tag: string;
  text: string;
}

interface ReviewPage {
  controls: ReviewControl[];
  path: string;
  screenshots: string[];
  text: string[];
}

const controlTags = new Set(["a", "button", "input", "select", "textarea"]);

async function readReviewPage(page: CaptureResult["pages"][number]): Promise<ReviewPage> {
  let elements: CapturedElement[] = [];

  try {
    const raw = JSON.parse(await readFile(page.slopEvidencePath, "utf8")) as {
      elements?: CapturedElement[];
    };

    elements = Array.isArray(raw.elements) ? raw.elements : [];
  } catch {
    elements = [];
  }

  const controls = elements
    .filter((element) => controlTags.has(element.tag))
    .map((element) => ({
      attributes: element.attributes,
      selector: element.selector,
      tag: element.tag,
      text: (element.directText || element.text).trim().slice(0, 120),
    }))
    .filter((control) => control.text !== "" || control.attributes["aria-label"] !== undefined)
    .slice(0, 40);
  const text = [
    ...new Set(
      elements
        .filter((element) => !controlTags.has(element.tag))
        .map((element) => element.directText.trim())
        .filter((value) => value !== ""),
    ),
  ].slice(0, 20);

  return {
    controls,
    path: page.path,
    screenshots: page.screenshots.map((screenshot) => screenshot.path),
    text,
  };
}

function reviewControlLine(control: ReviewControl): string {
  const attributes = Object.entries(control.attributes)
    .map(([name, value]) => `${name}="${value}"`)
    .join(", ");
  const confirm = control.attributes["data-confirm"] ?? control.attributes.onclick;
  const state = control.attributes["data-state"];

  return `- ${control.tag} "${control.text}" [${attributes === "" ? "no attributes" : attributes}; confirm: ${confirm === undefined ? "none" : `"${confirm}"`}; state: ${state ?? "none"}]`;
}

function buildCritiqueBrief(
  summary: ScopeSummary,
  findings: StoredFinding[],
  errors: Array<AuditCheckError & { page: string }>,
  reviewPages: ReviewPage[],
): string {
  const citations = [...new Set(findings.map((finding) => finding.citation))].sort();
  const issueLines =
    findings.length === 0
      ? ["Automated issues: none."]
      : [
          "Automated issues:",
          ...findings.map(
            (finding) =>
              `- ${finding.page ?? "Page"}: ${finding.title} [${finding.citation}], severity ${finding.severity}.`,
          ),
        ];
  const errorLines =
    errors.length === 0
      ? ["- None."]
      : errors.map(
          (error) => `- ${error.page}: ${error.check} on ${error.selector}. ${error.message}`,
        );

  return [
    `Scope: ${summary.name} (${summary.id}).`,
    `Pages captured: ${summary.pages.join(", ")}.`,
    `Automated findings: ${findings.length}.`,
    `Citations: ${citations.length === 0 ? "none" : citations.join(", ")}.`,
    ...issueLines,
    "Pages to review:",
    ...reviewPages.flatMap((page) => [
      `- ${page.path}: ${page.screenshots.join(", ")}`,
      ...page.controls.map(reviewControlLine),
      ...page.text.map((text) => `- text "${text}"`),
    ]),
    critiqueInstructions,
    "Checks that hit errors:",
    ...errorLines,
  ].join("\n");
}

export function createFitroomServer(options: FitroomServerOptions = {}): McpServer {
  const server = new McpServer(fitroomServerInfo);
  const projectRoot = options.projectRoot ?? process.cwd();
  const configuredAppUrl = options.appUrl ?? process.env.FITROOM_APP_URL;
  const configuredCurrentPath = options.currentPath ?? process.env.FITROOM_CURRENT_PATH;
  const currentPath =
    configuredCurrentPath === undefined ? undefined : normalizePath(configuredCurrentPath);
  let activeRoundSlots: Array<{
    name: string;
    role: VariantRole;
    slug: string | null;
    slot: number;
  }> = [];
  let auditedFindings: StoredFinding[] = [];
  let lastAudit: AuditPayload | null = null;
  let activeRoute: string | null = null;
  const judgedFindings = new Map<string, StoredFinding>();
  const registeredSlots = new Set<number>();
  const registeredVariants = new Map<string, RegisteredVariant>();

  async function boardFallback(): Promise<BoardState> {
    const current = await readBoardState(projectRoot);

    if (current.scope.id !== "") {
      return current;
    }

    if (lastAudit !== null) {
      return emptyBoardState({ id: lastAudit.summary.id, name: lastAudit.summary.name });
    }

    try {
      const { state } = await scopeState();

      if (state.defaultScope !== null) {
        return emptyBoardState({
          id: state.defaultScope.scope.id,
          name: state.defaultScope.scope.name,
        });
      }
    } catch {}

    return current;
  }

  async function syncBoard(
    update: (state: BoardState) => BoardState | Promise<BoardState>,
  ): Promise<BoardState> {
    return updateBoardState(projectRoot, update, await boardFallback());
  }

  async function syncAuditFindings(payload: AuditPayload): Promise<void> {
    const citationUrls = new Map(
      citationRegistry.citations.map((citation) => [citation.id, citation.url]),
    );

    await syncBoard((current) => ({
      ...current,
      page: payload.pages[0]?.path ?? "/",
      scope: { id: payload.summary.id, name: payload.summary.name },
      findings: payload.findings.map((finding) => ({
        id: finding.id,
        title: finding.title,
        citation: finding.citation,
        citationUrl: citationUrls.get(finding.citation) ?? "",
        severity: finding.severity,
        confidence: finding.confidence,
        variantSlug: "",
        fix: finding.fix,
        ...(finding.page === undefined ? {} : { page: finding.page }),
      })),
    }));
  }

  async function appUrl(): Promise<string> {
    if (configuredAppUrl !== undefined) {
      return configuredAppUrl;
    }

    const detected = await detectProjectDevServer(projectRoot);

    if (detected === null) {
      throw new Error("No local dev server found. Start your app and try again.");
    }

    return detected;
  }

  async function scopeState(): Promise<{
    config: ScopesConfig;
    defaultScope: DefaultScope | null;
    routes: DiscoveredRoute[];
    state: ScopeState;
  }> {
    const discovery = await discoverRoutesWithSource(
      projectRoot,
      configuredAppUrl === undefined ? {} : { fallbackUrl: configuredAppUrl },
    );
    const config = await loadScopes(projectRoot, { routes: discovery.routes });
    const routes = discovery.routes;
    const defaultScope = await detectDefaultScope(
      projectRoot,
      config,
      routes,
      currentPath === undefined ? {} : { lastRequestedRoute: currentPath },
    );
    const state: ScopeState = {
      currentPage: defaultScope?.route ?? currentPath ?? null,
      defaultScope,
      scopes: buildScopeChecklist(config, defaultScope?.scope.id),
    };

    return { config, defaultScope, routes, state };
  }

  function selectionFromPages(
    config: ScopesConfig,
    routes: readonly DiscoveredRoute[],
    pages: readonly string[],
  ): CaptureSelection {
    const normalized = [...new Set(pages.map((page) => normalizePagePath(page)))];
    const knownRoutes = new Set(routes.map((route) => route.path));

    for (const page of normalized) {
      if (!knownRoutes.has(page)) {
        throw new Error(`Unknown page ${page}. Call fr_scopes to list available pages.`);
      }
    }

    const matchingScope = findScopeForRoutes(config, normalized);

    return {
      id: matchingScope?.id ?? "custom",
      name: matchingScope?.name ?? "Custom selection",
      pages: normalized,
    };
  }

  function scopeSelection(config: ScopesConfig, scopeId: string): CaptureSelection {
    const scope = findScope(config, scopeId);

    if (scope === undefined) {
      throw new Error(`Unknown scope ${scopeId}. Call fr_scopes to list available scopes.`);
    }

    return {
      id: scope.id,
      name: scope.name,
      pages: scope.routes,
    };
  }

  async function resolveSelection(input: {
    pages?: string[] | undefined;
    scope?: string | undefined;
  }): Promise<ResolvedScopeSelection> {
    const { config, defaultScope, routes, state } = await scopeState();

    if (input.scope !== undefined && input.pages !== undefined) {
      throw new Error("Use either scope or pages, not both.");
    }

    if (input.pages !== undefined) {
      return {
        ...state,
        selection: selectionFromPages(config, routes, input.pages),
      };
    }

    if (input.scope !== undefined) {
      return {
        ...state,
        selection: scopeSelection(config, input.scope),
      };
    }

    if (defaultScope !== null) {
      return {
        ...state,
        selection: {
          id: defaultScope.scope.id,
          name: defaultScope.scope.name,
          pages: defaultScope.scope.routes,
        },
      };
    }

    return { ...state, selection: null };
  }

  function needsScope(input: ResolvedScopeSelection): Record<string, unknown> {
    return {
      needsScope: true,
      message: "No page group is selected. Choose a scope, then call the tool again.",
      currentPage: input.currentPage,
      defaultScope: input.defaultScope?.scope ?? null,
      defaultSource: input.defaultScope?.source ?? null,
      scopes: input.scopes,
    };
  }

  async function runCapture(selection: CaptureSelection): Promise<CaptureResult> {
    return capture(await appUrl(), selection, {
      projectRoot,
      ...(options.captureOutputDir === undefined ? {} : { outputDir: options.captureOutputDir }),
    });
  }

  async function surfaceForRoute(route: string): Promise<DirectionSurface> {
    const routes = await discoverRoutes(
      projectRoot,
      configuredAppUrl === undefined ? {} : { fallbackUrl: configuredAppUrl },
    );
    const routeInfo = routes.find((entry) => entry.path === route);

    if (routeInfo === undefined) {
      throw new Error(`Route ${route} is not in the project. Run fr_scopes to list pages.`);
    }

    const grouped = groupRoutes(routes);
    const group = PAGE_GROUPS.find((entry) =>
      grouped[entry].some((candidate) => candidate.path === routeInfo.path),
    );

    if (group === "marketing") {
      return "marketing";
    }

    if (group === "dashboard") {
      return "dashboard";
    }

    return "app";
  }

  function requiredDirection(slug: string): DesignDirection {
    const direction = getDirection(slug);

    if (direction === undefined) {
      throw new Error(`Direction ${slug} is missing from the library.`);
    }

    return direction;
  }

  function evidenceSelector(finding: CitationFinding): string | null {
    return typeof finding.evidence === "string" ? null : finding.evidence.selector;
  }

  function newWcagFailures(
    baseline: readonly StoredFinding[],
    preview: readonly CitationFinding[],
  ): CitationFinding[] {
    const remaining = new Map<string, number>();

    for (const finding of baseline) {
      if (finding.citation.startsWith("wcag22-")) {
        remaining.set(finding.citation, (remaining.get(finding.citation) ?? 0) + 1);
      }
    }

    const failures: CitationFinding[] = [];

    for (const finding of preview) {
      if (!finding.citation.startsWith("wcag22-")) {
        continue;
      }

      const allowed = remaining.get(finding.citation) ?? 0;

      if (allowed > 0) {
        remaining.set(finding.citation, allowed - 1);
      } else {
        failures.push(finding);
      }
    }

    return failures;
  }

  function boardLaunchCommand(): { args: string[]; command: string } {
    const base =
      options.boardCommand ??
      (process.argv[1] === undefined ? ["fitroom"] : [process.execPath, process.argv[1]]);
    const command = base[0] ?? "fitroom";
    const args = [...base.slice(1), "board"];

    return { command, args };
  }

  async function waitForBoardLock(timeoutMilliseconds: number) {
    const deadline = Date.now() + timeoutMilliseconds;

    while (Date.now() <= deadline) {
      const lock = await readLiveBoardLock(projectRoot);

      if (lock !== null) {
        return lock;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return null;
  }

  server.registerTool(
    "fr_states",
    {
      title: "Check every important UI state",
      description:
        "Reach empty, loading, error, long text and dark mode from outside the app, score each state, and save screenshots and a report.",
      inputSchema: {
        route: z.string().trim().min(1).optional(),
        scope: z.string().trim().min(1).optional(),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ route, scope }) =>
      runTool(async () => {
        let targetRoute = route === undefined ? activeRoute : normalizePath(route);

        if (scope !== undefined) {
          const config = await loadScopes(
            projectRoot,
            configuredAppUrl === undefined ? {} : { fallbackUrl: configuredAppUrl },
          );
          const found = findScope(config, scope);

          if (found === undefined) {
            throw new Error(`Unknown scope ${scope}. Call fr_scopes to list available scopes.`);
          }

          targetRoute = found.routes[0] ?? null;
        }

        if (targetRoute === null) {
          targetRoute = lastAudit?.pages[0]?.path ?? currentPath ?? "/";
        }

        return checkStates({
          baseUrl: await appUrl(),
          projectRoot,
          route: targetRoute,
        });
      }),
  );

  server.registerTool(
    "fr_open_board",
    {
      title: "Open the design board",
      description:
        "Start the local design board if it is not running, then return its address. The board stays on 127.0.0.1.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
      },
    },
    async () =>
      runTool(async () => {
        const live = await readLiveBoardLock(projectRoot);

        if (live !== null) {
          return { ...live, started: false };
        }

        const board = await readBoardState(projectRoot);
        const launch = boardLaunchCommand();
        const args = [...launch.args];

        if (board.scope.id !== "") {
          args.push("--scope", board.scope.id);
        }

        if (configuredAppUrl !== undefined) {
          args.push("--url", configuredAppUrl);
        }

        const child = spawn(launch.command, args, {
          cwd: projectRoot,
          detached: process.platform !== "win32",
          env: process.env,
          stdio: "ignore",
        });
        let spawnError: string | null = null;

        child.once("error", (error) => {
          spawnError = error.message;
        });
        child.unref();

        const lock = await waitForBoardLock(options.boardStartTimeoutMs ?? 15_000);

        if (lock === null) {
          if (spawnError !== null) {
            throw new Error(`Could not start the board. ${spawnError}`);
          }

          throw new Error(
            "The board did not start. Run fitroom board in your project, then try again.",
          );
        }

        return { ...lock, started: true };
      }),
  );

  server.registerTool(
    "fr_design_memory",
    {
      title: "Read the design memory",
      description:
        "Return the saved design memory from the latest approved handoff, or say that no design memory exists yet.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
      },
    },
    async () =>
      runTool(async () => {
        const memory = await readDesignMemory(projectRoot);

        if (memory === null) {
          return {
            exists: false,
            message: "No design memory exists. Approve a design and run fr_handoff first.",
          };
        }

        return {
          exists: true,
          files: [".fitroom/DESIGN.md", ".fitroom/design-memory.json"],
          memory,
        };
      }),
  );

  server.registerTool(
    "fr_board_status",
    {
      title: "Read the board status",
      description: "Return the board state and any open requests from the board.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
      },
    },
    async () =>
      runTool(async () => {
        const board = await readBoardState(projectRoot);
        const requests = await readBoardRequests(projectRoot);

        return {
          board,
          requests: openBoardRequests(requests),
        };
      }),
  );

  server.registerTool(
    "fr_wait_for_user",
    {
      title: "Wait for the user",
      description:
        "Wait until the board has an open request or the user approves a direction. Returns a timeout result after 600 seconds by default.",
      inputSchema: {
        timeoutSeconds: z.number().int().min(1).max(3_600).optional(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ timeoutSeconds }) =>
      runTool(async () => {
        return waitForBoardEvent(projectRoot, (timeoutSeconds ?? 600) * 1_000);
      }),
  );

  server.registerTool(
    "fr_complete_request",
    {
      title: "Complete a board request",
      description: "Mark a board request as done.",
      inputSchema: {
        id: z.string().trim().min(1),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ id }) =>
      runTool(async () => {
        return completeBoardRequest(projectRoot, id);
      }),
  );

  server.registerTool(
    "fr_scopes",
    {
      title: "List Fitroom scopes",
      description:
        "List every Fitroom page group with its routes and identify the group for the page in view.",
      annotations: {
        readOnlyHint: true,
      },
    },
    async () =>
      runTool(async () => {
        const { state } = await scopeState();

        return {
          currentPage: state.currentPage,
          currentGroup: state.defaultScope?.scope.id ?? null,
          defaultScope: state.defaultScope?.scope ?? null,
          defaultSource: state.defaultScope?.source ?? null,
          needsChoice: state.defaultScope === null,
          scopes: state.scopes,
        };
      }),
  );

  server.registerTool(
    "fr_capture",
    {
      title: "Capture a page group",
      description:
        "Capture only the selected Fitroom page group at 375, 768, and 1440 pixels. Uses the current route scope when no scope is given. Returns the scope summary and screenshot paths.",
      inputSchema: scopeInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ pages, scope }) =>
      runTool(async (): Promise<CapturePayload | Record<string, unknown>> => {
        const resolved = await resolveSelection({ pages, scope });

        if (resolved.selection === null) {
          return needsScope(resolved);
        }

        const result = await runCapture(resolved.selection);

        return {
          summary: result.summary,
          screenshots: result.pages.flatMap((page) =>
            page.screenshots.map((screenshot) => screenshot.path),
          ),
          pages: result.pages,
        };
      }),
  );

  server.registerTool(
    "fr_audit",
    {
      title: "Audit a page group",
      description:
        "Capture the selected page group, run automated accessibility checks, and return findings with a critique brief for the agent. Uses the current route scope when no scope is given.",
      inputSchema: scopeInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ pages, scope }) =>
      runTool(async (): Promise<AuditPayload | Record<string, unknown>> => {
        const resolved = await resolveSelection({ pages, scope });

        if (resolved.selection === null) {
          return needsScope(resolved);
        }

        const captured = await runCapture(resolved.selection);
        const auditRoot =
          options.auditOutputDir ??
          path.resolve(projectRoot, ".fitroom", "audits", resolved.selection.id);
        const errors: Array<AuditCheckError & { page: string }> = [];
        const findings: StoredFinding[] = [];
        const designMemory = await readDesignMemory(projectRoot);

        for (const page of captured.pages) {
          const report = await runAutomatedChecks(page.url, {
            outputDir: path.join(auditRoot, routeDirectoryName(page.path)),
          });

          findings.push(
            ...report.findings.map((finding) => ({
              ...finding,
              id: findingIdForPage(page.path, finding.id),
              page: page.path,
            })),
          );
          errors.push(
            ...report.errors.map((error) => ({
              ...error,
              page: page.path,
            })),
          );

          if (designMemory !== null) {
            const memoryFindings = await auditDesignMemory({
              outputDir: path.join(auditRoot, routeDirectoryName(page.path), "design-memory"),
              projectRoot,
              url: page.url,
            });

            findings.push(
              ...memoryFindings.map((finding) => ({
                ...finding,
                id: findingIdForPage(page.path, finding.id),
                page: page.path,
              })),
            );
          }
        }

        auditedFindings = findings;
        activeRoute = null;
        judgedFindings.clear();

        const reviewPages = await Promise.all(captured.pages.map(readReviewPage));
        const payload: AuditPayload = {
          summary: captured.summary,
          screenshots: captured.pages.flatMap((page) =>
            page.screenshots.map((screenshot) => screenshot.path),
          ),
          pages: captured.pages,
          critiqueBrief: buildCritiqueBrief(captured.summary, findings, errors, reviewPages),
          errors,
          findings,
        };

        lastAudit = payload;
        await syncAuditFindings(payload);

        return payload;
      }),
  );

  server.registerTool(
    "fr_slop",
    {
      title: "Check for AI slop",
      description:
        "Score the latest capture for generic AI design patterns and save a 1200 by 630 score card.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
      },
    },
    async () =>
      runTool(async () => {
        if (lastAudit === null) {
          throw new Error("Run fr_audit before checking for slop.");
        }

        const report = await detectSlop({
          summary: lastAudit.summary,
          pages: lastAudit.pages,
        });
        const scoreCardPath = path.join(
          projectRoot,
          ".fitroom",
          "slop",
          `${lastAudit.summary.id}-${Date.now()}.png`,
        );

        await renderSlopScoreCard(report, scoreCardPath);

        return {
          ...report,
          scoreCardPath,
        };
      }),
  );

  server.registerTool(
    "fr_directions",
    {
      title: "Build four design directions",
      description:
        "Read the latest audit for a route, detect its surface, and return Refined, Native, Bold and Wildcard direction briefs with evidence and writing rules.",
      inputSchema: {
        route: z.string().trim().min(1),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ route }) =>
      runTool(async () => {
        const normalizedRoute = normalizePath(route);

        if (lastAudit === null) {
          throw new Error("Run fr_audit before asking for directions.");
        }

        const page = lastAudit.pages.find((candidate) => candidate.path === normalizedRoute);

        if (page === undefined) {
          throw new Error(
            `Route ${normalizedRoute} is not in the latest audit. Run fr_audit for its scope first.`,
          );
        }

        const surface = await surfaceForRoute(normalizedRoute);
        const [contentInventory, detectedDesignSystem] = await Promise.all([
          readContentInventory(page.accessibilityTreePath),
          detectDesignSystem(projectRoot),
        ]);
        const designSystem: DirectionDesignSystem = {
          ...detectedDesignSystem,
          summary: designSystemSummary(detectedDesignSystem),
        };
        const refinedDirection = {
          slug: "refined",
          name: "Refined",
          surfaces: [surface],
          description:
            "Keep the current design and fix audit findings, spacing and hierarchy in the existing style.",
          modes: ["light", "deep"],
        };
        const directionBySlot = [
          { slot: 1, role: "refined" as const, direction: refinedDirection },
          {
            slot: 2,
            role: "native" as const,
            direction: requiredDirection(nativeBySurface[surface]),
          },
          {
            slot: 3,
            role: "bold" as const,
            direction: requiredDirection(boldBySurface[surface]),
          },
          {
            slot: 4,
            role: "wildcard" as const,
            direction: requiredDirection(wildcardBySurface[surface]),
          },
        ];
        const slots: DirectionSlot[] = directionBySlot.map((slot) => ({
          ...slot,
          screenshots: page.screenshots,
          contentInventory,
          designSystem,
          writingRules,
        }));

        const auditSummary = lastAudit.summary;
        const history = await readRegenerationHistory(projectRoot);
        const existing = history.scopes[auditSummary.id];
        const session: RegenerationSession = existing ?? {
          scopeId: auditSummary.id,
          scopeName: auditSummary.name,
          surface,
          pinnedSlots: [],
          rounds: [],
          seenDirections: [],
          baselineScreenshots: page.screenshots,
        };
        const roundNumber = session.rounds.length + 1;
        const regeneratedSlots: RegeneratedSlot[] = directionBySlot.map((slot) => {
          const direction = slot.direction as { name?: string; slug?: string };

          return {
            slot: slot.slot as VariantSlotNumber,
            role: slot.role,
            directionSlug: slot.slot === 1 ? null : (direction.slug ?? null),
            direction: slot.direction as RegeneratedSlot["direction"],
            name: direction.name ?? "Refined",
            rationale:
              slot.slot === 1
                ? "Keeps the current style while fixing audit findings."
                : `${direction.name ?? "Direction"} fits the ${surface} surface.`,
            ...(slot.slot === 1 ? { mode: "light" as const } : {}),
            screenshotPaths:
              slot.slot === 1 ? page.screenshots.map((screenshot) => screenshot.path) : [],
          };
        });

        activeRoundSlots = regeneratedSlots.map((slot) => ({
          name: slot.name,
          role: slot.role,
          slug: slot.directionSlug,
          slot: slot.slot,
        }));

        session.scopeName = auditSummary.name;
        session.surface = surface;
        session.baselineScreenshots = page.screenshots;
        session.rounds.push({
          id: String(roundNumber),
          createdAt: new Date().toISOString(),
          mode: "light",
          slots: regeneratedSlots,
        });
        session.seenDirections = [
          ...new Set([
            ...session.seenDirections,
            ...regeneratedSlots.flatMap((slot) =>
              slot.directionSlug === null ? [] : [slot.directionSlug],
            ),
          ]),
        ];
        history.scopes[auditSummary.id] = session;
        await writeRegenerationHistory(projectRoot, history);
        await ensureRound(projectRoot, roundNumber, auditSummary);
        activeRoute = normalizedRoute;
        registeredSlots.clear();
        await syncBoard((current) => ({
          ...current,
          page: normalizedRoute,
          scope: { id: auditSummary.id, name: auditSummary.name },
          surface,
          round: roundNumber,
          status: "directions_ready",
          variants: [],
          selected: null,
          approved: null,
        }));

        return {
          route: normalizedRoute,
          surface,
          slots,
        };
      }),
  );

  server.registerTool(
    "fr_regenerate",
    {
      title: "Regenerate design variants",
      description:
        "Regenerate unpinned slots. Slot 1 stays a Refined version of the current design. Slots 2 to 4 pick new directions that fit the scope surface and avoid history.",
      inputSchema: {
        scope: z.string().trim().min(1),
        slots: z.array(z.number().int().min(1).max(4)).min(1).optional(),
        mode: z.enum(["light", "deep"]).optional(),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ scope: scopeId, slots, mode }) =>
      runTool(async () => {
        if (lastAudit === null) {
          throw new Error("Run fr_audit before regenerating variants.");
        }

        const config = await loadScopes(
          projectRoot,
          configuredAppUrl === undefined ? {} : { fallbackUrl: configuredAppUrl },
        );
        const scope = findScope(config, scopeId);

        if (scope === undefined) {
          throw new Error(`Unknown scope ${scopeId}. Call fr_scopes to list available scopes.`);
        }

        const route = scope.routes[0];

        if (route === undefined) {
          throw new Error(`Scope ${scope.name} has no pages.`);
        }

        const surface = await surfaceForRoute(route);
        const pagesInScope = lastAudit.pages.filter((page) => scope.routes.includes(page.path));
        const baselinePage =
          pagesInScope.find((page) => page.path === activeRoute) ?? pagesInScope[0];
        const result = await regenerateScope({
          projectRoot,
          scopeId: scope.id,
          scopeName: scope.name,
          surface,
          baselineScreenshots: baselinePage?.screenshots ?? [],
          ...(slots === undefined ? {} : { slots }),
          ...(mode === undefined ? {} : { mode }),
        });
        const roundNumber = result.session.rounds.length;

        await ensureRound(projectRoot, roundNumber, scope);
        registeredSlots.clear();
        activeRoundSlots = result.round.slots.map((slot) => ({
          name: slot.name,
          role: slot.role,
          slug: slot.directionSlug,
          slot: slot.slot,
        }));
        const previousRounds = result.session.rounds.slice(0, -1);
        const boardPreviousRounds = previousRounds.map((previous) => ({
          id: previous.id,
          createdAt: previous.createdAt,
          variants: previous.slots.map((slot) => ({
            slot: slot.slot,
            name: slot.name,
            slug: slot.directionSlug ?? "refined",
          })),
        }));

        const currentBoard = await syncBoard((board) => ({
          ...board,
          page: activeRoute ?? route,
          scope: { id: scope.id, name: scope.name },
          surface,
          round: roundNumber,
          status: "directions_ready",
          selected: null,
          approved: null,
          previousRounds: boardPreviousRounds,
          variants: result.round.slots.map((slot) => {
            const slug = slot.directionSlug ?? "refined";
            const previous = board.variants.find(
              (variant) => variant.slot === slot.slot && variant.slug === slug,
            );

            return {
              slug,
              name: slot.name,
              rationale: slot.rationale,
              slot: slot.slot,
              pinned: result.session.pinnedSlots.includes(slot.slot),
              role: slot.role,
              ...(slot.mode === undefined ? {} : { mode: slot.mode }),
              ...(previous?.filePath === undefined ? {} : { filePath: previous.filePath }),
              ...(previous?.previewPath === undefined ? {} : { previewPath: previous.previewPath }),
              ...(previous?.screenshotPath === undefined
                ? {}
                : { screenshotPath: previous.screenshotPath }),
            };
          }),
        }));

        for (const variant of currentBoard.variants) {
          if (variant.filePath === undefined || variant.role === undefined) {
            continue;
          }

          try {
            await access(path.resolve(projectRoot, variant.filePath));
          } catch {
            continue;
          }

          await saveRoundSnapshot(projectRoot, {
            number: roundNumber,
            scope: currentBoard.scope,
            variant: {
              editLogPath: path.join(projectRoot, ".fitroom", "edits", `${variant.slug}.json`),
              filePath: path.resolve(projectRoot, variant.filePath),
              name: variant.name,
              origPath: path.join(projectRoot, ".fitroom", "variants", `${variant.slug}.orig.tsx`),
              rationale: variant.rationale,
              role: variant.role,
              ...(variant.screenshotPath === undefined
                ? {}
                : { screenshotPath: variant.screenshotPath }),
              slug: variant.slug,
              slot: variant.slot,
            },
          });
        }

        return {
          scope: scope.id,
          scopeName: scope.name,
          surface,
          mode: result.round.mode,
          pinnedSlots: result.session.pinnedSlots,
          changedSlots: result.changedSlots,
          slots: result.round.slots,
          previousRounds,
        };
      }),
  );

  server.registerTool(
    "fr_register_variant",
    {
      title: "Register a design variant",
      description:
        "Type-check a variant, render it on the preview route, screenshot it, and reject new WCAG AA failures.",
      inputSchema: {
        slug: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a lowercase hyphenated slug."),
        filePath: z.string().trim().min(1),
        rationale: z.string().trim().min(1),
        slot: z.number().int().min(1).max(4).optional(),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ slug, filePath, rationale, slot: requestedSlot }) =>
      runTool(async () => {
        if (activeRoute === null) {
          throw new Error("Run fr_directions before registering a variant.");
        }

        const projectDirectory = path.resolve(projectRoot);
        const resolvedFile = path.resolve(projectRoot, filePath);

        if (
          resolvedFile !== projectDirectory &&
          !resolvedFile.startsWith(`${projectDirectory}${path.sep}`)
        ) {
          throw new Error("Variant files must stay inside the project.");
        }

        try {
          await access(resolvedFile);
        } catch {
          throw new Error(`Variant file ${filePath} was not found.`);
        }

        const typecheck = typecheckVariant(resolvedFile, projectRoot);

        if (!typecheck.passed) {
          return {
            accepted: false,
            errors: typecheck.errors,
            newFailures: [],
            renderErrors: [],
            slug,
            rationale,
            typecheck,
          };
        }

        await stampVariantFile(resolvedFile);
        await saveVariantOriginal(resolvedFile, { projectRoot, slug });
        await rm(path.join(projectRoot, ".fitroom", "edits", `${slug}.json`), { force: true });

        const preview = await previewVariant(projectRoot, resolvedFile, slug);

        if (preview.errors.length > 0 || preview.renderErrors.length > 0) {
          return {
            accepted: false,
            errors: preview.errors,
            newFailures: [],
            previewUrl: preview.previewUrl,
            renderErrors: preview.renderErrors,
            screenshotPath: preview.screenshotPath,
            slug,
            rationale,
            typecheck,
          };
        }

        const baseline = auditedFindings.filter((finding) => finding.page === activeRoute);
        const newFailures = newWcagFailures(baseline, preview.findings);
        const accepted = newFailures.length === 0;

        if (accepted && preview.reference !== null) {
          const designSystem = await detectDesignSystem(projectRoot);
          const fixedFindings = baseline.filter(
            (finding) =>
              !preview.findings.some(
                (previewFinding) =>
                  previewFinding.citation === finding.citation &&
                  evidenceSelector(previewFinding) === evidenceSelector(finding),
              ),
          );

          registeredVariants.set(slug, {
            filePath: resolvedFile,
            findingsFixed: fixedFindings,
            rationale,
            reference: preview.reference,
            route: activeRoute,
            tokens: flattenTokens(designSystem.tokens),
            variantSlug: slug,
          });
        }

        const inferredSlot =
          requestedSlot ??
          activeRoundSlots.find((slot) => slot.slug === slug)?.slot ??
          activeRoundSlots.find((slot) => !registeredSlots.has(slot.slot))?.slot ??
          1;
        const slotNumber = inferredSlot;
        const roundSlot = activeRoundSlots.find((slot) => slot.slot === slotNumber);
        const scope =
          lastAudit === null
            ? undefined
            : { id: lastAudit.summary.id, name: lastAudit.summary.name };
        const directionName = roundSlot?.name ?? slug;
        const relativeFile = path.relative(projectRoot, resolvedFile).split(path.sep).join("/");

        if (accepted) {
          registeredSlots.add(slotNumber);
          const current = await syncBoard((board) => {
            const previous = board.variants.find((variant) => variant.slot === slotNumber);
            const variants = board.variants
              .filter((variant) => variant.slot !== slotNumber)
              .concat({
                slug,
                name: directionName,
                rationale,
                slot: slotNumber,
                pinned: previous?.pinned ?? false,
                ...(slotNumber === 1 ? { mode: "light" as const } : {}),
                ...(roundSlot === undefined ? {} : { role: roundSlot.role }),
                filePath: relativeFile,
                previewPath: `.fitroom/previews/${slug}/index.html`,
                ...(preview.screenshotPath === null
                  ? {}
                  : {
                      screenshotPath: path
                        .relative(projectRoot, preview.screenshotPath)
                        .split(path.sep)
                        .join("/"),
                    }),
              })
              .sort((first, second) => first.slot - second.slot);

            return {
              ...board,
              ...(scope === undefined ? {} : { scope }),
              round: Math.max(1, board.round),
              status: "directions_ready",
              variants,
            };
          });
          const boardVariant = current.variants.find((variant) => variant.slot === slotNumber);

          if (boardVariant !== undefined && boardVariant.role !== undefined) {
            await saveRoundSnapshot(projectRoot, {
              number: current.round,
              scope: current.scope,
              variant: {
                editLogPath: path.join(projectRoot, ".fitroom", "edits", `${slug}.json`),
                filePath: resolvedFile,
                name: directionName,
                origPath: path.join(projectRoot, ".fitroom", "variants", `${slug}.orig.tsx`),
                rationale,
                role: boardVariant.role,
                ...(preview.screenshotPath === null
                  ? {}
                  : { screenshotPath: preview.screenshotPath }),
                slug,
                slot: slotNumber,
              },
            });
          }
        }

        return {
          accepted: newFailures.length === 0,
          errors: newFailures.length === 0 ? [] : ["The variant adds new WCAG AA failures."],
          newFailures,
          previewUrl: preview.previewUrl,
          renderErrors: [],
          screenshotPath: preview.screenshotPath,
          slug,
          rationale,
          typecheck,
        };
      }),
  );

  server.registerTool(
    "fr_handoff",
    {
      title: "Write a design handoff",
      description:
        "Write the accepted variant, reference screenshots, tokens and implementation brief to a handoff folder.",
      inputSchema: {
        variantSlug: z.string().trim().min(1),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ variantSlug }) =>
      runTool(async () => {
        const variant = registeredVariants.get(variantSlug);

        if (variant === undefined) {
          throw new Error(
            `Variant ${variantSlug} is not registered. Register an accepted variant first.`,
          );
        }

        let edits: unknown = { version: 1, files: {} };

        try {
          edits = JSON.parse(
            await readFile(
              path.join(projectRoot, ".fitroom", "edits", `${variant.variantSlug}.json`),
              "utf8",
            ),
          ) as unknown;
        } catch {
          try {
            edits = JSON.parse(
              await readFile(path.join(projectRoot, ".fitroom", "edits.json"), "utf8"),
            ) as unknown;
          } catch {}
        }

        const refreshed = await previewVariant(projectRoot, variant.filePath, variant.variantSlug);

        if (refreshed.reference === null) {
          const reason =
            refreshed.renderErrors[0] ??
            refreshed.errors[0] ??
            "The current variant did not render.";

          throw new Error(`Could not render variant ${variantSlug}. ${reason}`);
        }

        variant.reference = refreshed.reference;

        const board = await readBoardState(projectRoot);
        const approvedSlug = board.approved?.slug ?? variant.variantSlug;
        const approvedVariant = board.variants.find((candidate) => candidate.slug === approvedSlug);
        const structure = await readStructure(projectRoot);
        const direction = getDirection(approvedSlug);
        const variantSource = await readFile(variant.filePath, "utf8");
        const designMemory = memoryFromDirection({
          buttonId: elementIdForTag(variantSource, "button"),
          direction,
          directionName: approvedVariant?.name ?? direction?.name ?? "Refined",
          directionSlug: approvedSlug,
          inputId: elementIdForTag(variantSource, "input"),
          reference: variant.reference,
          structure,
          tokens: variant.tokens,
        });
        const savedMemory = await saveDesignMemory(projectRoot, designMemory);
        const handoff = await writeHandoff({
          edits,
          findingsFixed: variant.findingsFixed,
          projectRoot,
          rationale: variant.rationale,
          reference: variant.reference,
          route: variant.route,
          ...(structure === null ? {} : { structure }),
          tokens: variant.tokens,
          variantFile: variant.filePath,
          variantSlug: variant.variantSlug,
        });

        await syncBoard((current) => ({
          ...current,
          approved: current.approved ?? {
            slug: variant.variantSlug,
            slot: current.variants.find((entry) => entry.slug === variant.variantSlug)?.slot ?? 1,
            round: current.round,
          },
          status: "handoff_created",
        }));

        return {
          brief: handoff.brief,
          designMemoryFiles: savedMemory.files,
          folder: handoff.folder,
          handoffId: handoff.handoffId,
          route: variant.route,
          screenshots: handoff.manifest.screenshots,
          tokens: variant.tokens,
        };
      }),
  );

  server.registerTool(
    "fr_verify",
    {
      title: "Verify an implementation",
      description:
        "Capture the route at three widths and compare pixels, computed styles and content order with a handoff.",
      inputSchema: {
        route: z.string().trim().min(1),
        handoffId: z.string().trim().min(1),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ route, handoffId }) =>
      runTool(async () => {
        if (!/^handoff-[a-z0-9-]+$/.test(handoffId)) {
          throw new Error(`Unknown handoff ${handoffId}.`);
        }

        const handoffDir = path.join(projectRoot, ".fitroom", "handoffs", handoffId);

        try {
          await access(handoffDir);
        } catch {
          throw new Error(`Handoff ${handoffId} was not found.`);
        }

        await syncBoard((current) => ({ ...current, status: "verifying" }));

        const report = await verifyImplementation({
          baseUrl: await appUrl(),
          handoffDir,
          outputDir: path.join(
            projectRoot,
            ".fitroom",
            "verifications",
            `${handoffId}-${Date.now()}`,
          ),
          route: normalizePath(route),
        });

        await syncBoard((current) => ({
          ...current,
          status: report.passed ? "verified" : "verify_failed",
        }));

        return {
          ...report,
          thresholds: {
            pixelDifferencePercentPerRegion: 2,
            tokenMismatches: 0,
            orderMismatches: 0,
          },
        };
      }),
  );

  server.registerTool(
    "fr_submit_findings",
    {
      title: "Submit judged findings",
      description:
        "Validate judged findings against the citation registry and merge them with the latest automated audit.",
      inputSchema: {
        findings: z.array(submittedFindingSchema).min(1),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ findings }) =>
      runTool(async () => {
        const errors: string[] = [];
        const accepted: StoredFinding[] = [];

        findings.forEach((finding, index) => {
          const normalized: StoredFinding = {
            id: finding.id ?? `judged-${randomUUID()}`,
            title: finding.title,
            citation: finding.citation,
            ...(finding.related === undefined ? {} : { related: finding.related }),
            severity: finding.severity,
            confidence: finding.confidence,
            evidence: finding.evidence,
            fix: finding.fix,
          };
          const result = validate(normalized);

          if (!result.valid) {
            errors.push(`Finding ${index + 1}: ${result.errors.join(" ")}`);
            return;
          }

          accepted.push(normalized);
        });

        if (errors.length > 0) {
          throw new Error(errors.join("\n"));
        }

        for (const finding of accepted) {
          judgedFindings.set(finding.id, finding);
        }

        const merged = new Map<string, StoredFinding>();

        for (const finding of auditedFindings) {
          merged.set(finding.id, finding);
        }

        for (const finding of judgedFindings.values()) {
          merged.set(finding.id, finding);
        }

        const allFindings = [...merged.values()];

        return {
          counts: {
            automated: auditedFindings.length,
            judged: judgedFindings.size,
            total: allFindings.length,
          },
          findings: allFindings,
        };
      }),
  );

  server.registerPrompt(
    "heuristic-review",
    {
      title: "Heuristic review",
      description:
        "Review captured screenshots against Nielsen's 10 heuristics and submit judged findings.",
    },
    () => ({
      description: "Review Fitroom screenshots with Nielsen's heuristics.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Review the screenshots from the latest fr_capture or fr_audit result.",
              "Check each page against Nielsen's 10 heuristics.",
              "Cite only citation ids from packages/citations/registry.json. Do not invent ids or URLs.",
              "Rate severity on the NN/g 0 to 4 scale. 0 is not a problem. 4 is a catastrophe.",
              'Mark confidence as "judged".',
              "Submit findings with fr_submit_findings. Point to the page and the element in plain English.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
