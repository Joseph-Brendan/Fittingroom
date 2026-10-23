import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  buildScopeChecklist,
  type CapturedPage,
  type CaptureResult,
  type CaptureSelection,
  capture,
  detectDefaultScope,
  detectDevServer,
  discoverRoutes,
  type Finding,
  findScope,
  findScopeForRoutes,
  loadScopes,
  normalizePagePath,
  runAutomatedChecks,
  type ScopeSummary,
} from "@fittingroom/core";

export interface AuditScopeOptions {
  currentPath?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  pages?: readonly string[];
  projectRoot?: string;
  scope?: string;
}

export interface AuditSelectionResult {
  defaultScopeId: string | null;
  prompted: boolean;
  selection: CaptureSelection;
}

export interface AuditCommandOptions extends AuditScopeOptions {
  appUrl?: string;
  auditOutputDir?: string;
  captureOutputDir?: string;
}

export type AuditFinding = Finding & { page: string };

export interface AuditCommandResult {
  findings: AuditFinding[];
  pages: CapturedPage[];
  summary: ScopeSummary;
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

function checklistText(entries: ReturnType<typeof buildScopeChecklist>): string {
  return [
    "Page groups:",
    ...entries.map(
      (entry, index) =>
        `[${entry.selected ? "x" : " "}] ${index + 1}. ${entry.name} (${entry.routes.length} pages): ${entry.routes.join(" ")}`,
    ),
  ].join("\n");
}

function selectionForScope(
  config: Awaited<ReturnType<typeof loadScopes>>,
  idOrName: string,
): CaptureSelection {
  const scope = findScope(config, idOrName);

  if (scope === undefined) {
    throw new Error(`Unknown scope ${idOrName}. Run fitroom scopes to list groups.`);
  }

  return {
    id: scope.id,
    name: scope.name,
    pages: scope.routes,
  };
}

function pagesSelection(
  config: Awaited<ReturnType<typeof loadScopes>>,
  pages: readonly string[],
  knownRoutes: ReadonlySet<string>,
): CaptureSelection {
  const normalized = [...new Set(pages.map((page) => normalizePagePath(page)))];

  if (normalized.length === 0) {
    throw new Error("Add at least one page with --pages.");
  }

  for (const page of normalized) {
    if (!knownRoutes.has(page)) {
      throw new Error(`Unknown page ${page}. Run fitroom scopes to list pages.`);
    }
  }

  const matchingScope = findScopeForRoutes(config, normalized);

  return {
    id: matchingScope?.id ?? "custom",
    name: matchingScope?.name ?? "Custom selection",
    pages: normalized,
  };
}

export async function selectAuditScope(
  options: AuditScopeOptions = {},
): Promise<AuditSelectionResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const config = await loadScopes(projectRoot);

  if (options.scope !== undefined) {
    return {
      defaultScopeId: null,
      prompted: false,
      selection: selectionForScope(config, options.scope),
    };
  }

  const routes = await discoverRoutes(projectRoot);

  if (options.pages !== undefined && options.pages.length > 0) {
    return {
      defaultScopeId: null,
      prompted: false,
      selection: pagesSelection(config, options.pages, new Set(routes.map((route) => route.path))),
    };
  }

  const configuredCurrentPath = options.currentPath ?? process.env.FITTINGROOM_CURRENT_PATH;
  const defaultScope = await detectDefaultScope(
    projectRoot,
    config,
    routes,
    configuredCurrentPath === undefined ? {} : { lastRequestedRoute: configuredCurrentPath },
  );
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  const checklist = buildScopeChecklist(config, defaultScope?.scope.id);
  const defaultName = defaultScope?.scope.name;
  const readline = createInterface({ input, output });

  output.write(`${checklistText(checklist)}\n`);

  try {
    const defaultHint = defaultName === undefined ? "" : ` Press Enter for ${defaultName}.`;
    const answer = (
      await readline.question(`Select a page group by number.${defaultHint} `)
    ).trim();

    if (answer === "") {
      if (defaultScope === null) {
        throw new Error("Choose a page group to continue.");
      }

      return {
        defaultScopeId: defaultScope.scope.id,
        prompted: true,
        selection: {
          id: defaultScope.scope.id,
          name: defaultScope.scope.name,
          pages: defaultScope.scope.routes,
        },
      };
    }

    const numericIndex = Number(answer);
    const selected =
      Number.isInteger(numericIndex) && numericIndex > 0
        ? checklist[numericIndex - 1]
        : findScope(config, answer);

    if (selected === undefined) {
      throw new Error(`Unknown page group ${answer}.`);
    }

    return {
      defaultScopeId: defaultScope?.scope.id ?? null,
      prompted: true,
      selection: {
        id: selected.id,
        name: selected.name,
        pages: selected.routes,
      },
    };
  } finally {
    readline.close();
  }
}

export async function runAuditCommand(
  options: AuditCommandOptions = {},
): Promise<AuditCommandResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const output = options.output ?? process.stdout;
  const selection = await selectAuditScope(options);
  const appUrl = options.appUrl ?? (await detectDevServer());

  if (appUrl === null) {
    throw new Error("No local dev server found. Start your app and try again.");
  }

  const captured: CaptureResult = await capture(appUrl, selection.selection, {
    projectRoot,
    ...(options.captureOutputDir === undefined ? {} : { outputDir: options.captureOutputDir }),
    onScope: (summary) => {
      output.write(`${summary.message}\n`);
    },
  });
  const auditRoot =
    options.auditOutputDir ??
    path.resolve(projectRoot, ".fittingroom", "audits", selection.selection.id);
  const findings: AuditFinding[] = [];

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

  if (findings.length === 0) {
    output.write("Automated findings: 0.\n");
  } else {
    output.write(`Automated findings: ${findings.length}.\n`);

    for (const finding of findings) {
      output.write(
        `- ${finding.page}: ${finding.title} [${finding.citation}], severity ${finding.severity}.\n`,
      );
    }
  }

  return {
    findings,
    pages: captured.pages,
    summary: captured.summary,
  };
}
