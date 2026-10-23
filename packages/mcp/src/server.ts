import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { type Finding as CitationFinding, validate } from "@fittingroom/citations";
import {
  buildScopeChecklist,
  type CaptureResult,
  type CaptureSelection,
  capture,
  type DefaultScope,
  type DiscoveredRoute,
  detectDefaultScope,
  detectDesignSystem,
  detectDevServer,
  discoverRoutes,
  findScope,
  findScopeForRoutes,
  groupRoutes,
  loadScopes,
  normalizePagePath,
  PAGE_GROUPS,
  readContentInventory,
  regenerateScope,
  runAutomatedChecks,
  type ScopeChecklistEntry,
  type ScopeSummary,
  type ScopesConfig,
  verifyImplementation,
  writeHandoff,
} from "@fittingroom/core";
import { type DesignDirection, type DirectionSurface, getDirection } from "@fittingroom/directions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { previewVariant } from "./preview.js";
import { typecheckVariant } from "./typecheck.js";

export const fittingRoomServerInfo = {
  name: "fitting-room",
  version: "0.0.0",
} as const;

export interface FittingRoomServerOptions {
  appUrl?: string;
  auditOutputDir?: string;
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
  findings: StoredFinding[];
  critiqueBrief: string;
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

function buildCritiqueBrief(summary: ScopeSummary, findings: StoredFinding[]): string {
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

  return [
    `Scope: ${summary.name} (${summary.id}).`,
    `Pages captured: ${summary.pages.join(", ")}.`,
    `Automated findings: ${findings.length}.`,
    `Citations: ${citations.length === 0 ? "none" : citations.join(", ")}.`,
    ...issueLines,
    critiqueInstructions,
  ].join("\n");
}

export function createFittingRoomServer(options: FittingRoomServerOptions = {}): McpServer {
  const server = new McpServer(fittingRoomServerInfo);
  const projectRoot = options.projectRoot ?? process.cwd();
  const configuredCurrentPath = options.currentPath ?? process.env.FITTINGROOM_CURRENT_PATH;
  const currentPath =
    configuredCurrentPath === undefined ? undefined : normalizePath(configuredCurrentPath);
  let auditedFindings: StoredFinding[] = [];
  let lastAudit: AuditPayload | null = null;
  let activeRoute: string | null = null;
  const judgedFindings = new Map<string, StoredFinding>();
  const registeredVariants = new Map<string, RegisteredVariant>();

  async function appUrl(): Promise<string> {
    if (options.appUrl !== undefined) {
      return options.appUrl;
    }

    const detected = await detectDevServer();

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
    const config = await loadScopes(projectRoot);
    const routes = await discoverRoutes(projectRoot);
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
    const routes = await discoverRoutes(projectRoot);
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

  server.registerTool(
    "fr_scopes",
    {
      title: "List Fitting Room scopes",
      description:
        "List every Fitting Room page group with its routes and identify the group for the page in view.",
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
        "Capture only the selected Fitting Room page group at 375, 768, and 1440 pixels. Uses the current route scope when no scope is given. Returns the scope summary and screenshot paths.",
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
          path.resolve(projectRoot, ".fittingroom", "audits", resolved.selection.id);
        const findings: StoredFinding[] = [];

        for (const page of captured.pages) {
          const pageFindings = await runAutomatedChecks(page.url, {
            outputDir: path.join(auditRoot, routeDirectoryName(page.path)),
          });

          findings.push(
            ...pageFindings.map((finding) => ({
              ...finding,
              page: page.path,
            })),
          );
        }

        auditedFindings = findings;
        activeRoute = null;
        judgedFindings.clear();

        const payload: AuditPayload = {
          summary: captured.summary,
          screenshots: captured.pages.flatMap((page) =>
            page.screenshots.map((screenshot) => screenshot.path),
          ),
          pages: captured.pages,
          findings,
          critiqueBrief: buildCritiqueBrief(captured.summary, findings),
        };

        lastAudit = payload;

        return payload;
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

        activeRoute = normalizedRoute;

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

        const config = await loadScopes(projectRoot);
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
        const previousRounds = result.session.rounds.slice(0, -1);

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
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ slug, filePath, rationale }) =>
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

          registeredVariants.set(slug, {
            filePath: resolvedFile,
            rationale,
            reference: preview.reference,
            route: activeRoute,
            tokens: flattenTokens(designSystem.tokens),
            variantSlug: slug,
          });
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

        const handoff = await writeHandoff({
          projectRoot,
          rationale: variant.rationale,
          reference: variant.reference,
          route: variant.route,
          tokens: variant.tokens,
          variantFile: variant.filePath,
          variantSlug: variant.variantSlug,
        });

        return {
          brief: handoff.brief,
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

        const handoffDir = path.join(projectRoot, ".fittingroom", "handoffs", handoffId);

        try {
          await access(handoffDir);
        } catch {
          throw new Error(`Handoff ${handoffId} was not found.`);
        }

        const report = await verifyImplementation({
          baseUrl: await appUrl(),
          handoffDir,
          outputDir: path.join(
            projectRoot,
            ".fittingroom",
            "verifications",
            `${handoffId}-${Date.now()}`,
          ),
          route: normalizePath(route),
        });

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
      description: "Review Fitting Room screenshots with Nielsen's heuristics.",
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
