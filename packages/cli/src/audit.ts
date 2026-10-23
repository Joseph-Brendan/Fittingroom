import path from "node:path";
import { createInterface } from "node:readline/promises";
import { validate } from "@fittingroom/citations";
import {
  type AuditCheckError,
  buildScopeChecklist,
  type CapturedPage,
  type CaptureResult,
  type CaptureSelection,
  capture,
  detectDefaultScope,
  detectDevServer,
  discoverRoutesWithSource,
  type Finding,
  findScope,
  findScopeForRoutes,
  loadScopes,
  normalizePagePath,
  runAutomatedChecks,
  type ScopeSummary,
  writeFileAtomic,
  writeJsonAtomic,
} from "@fittingroom/core";

export interface AuditScopeOptions {
  appUrl?: string;
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
  auditOutputDir?: string;
  captureOutputDir?: string;
}

export type AuditFinding = Finding & { page: string };

export type AuditCommandError = AuditCheckError & { page: string };

export interface AuditCommandResult {
  errors: AuditCommandError[];
  findings: AuditFinding[];
  findingsPath: string;
  pages: CapturedPage[];
  reportPath: string;
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

function pageCountLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

function checklistText(entries: ReturnType<typeof buildScopeChecklist>): string {
  return [
    "Page groups:",
    ...entries.map(
      (entry, index) =>
        `[${entry.selected ? "x" : " "}] ${index + 1}. ${entry.name} (${pageCountLabel(entry.routes.length)}): ${entry.routes.join(" ")}`,
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
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  const discovery = await discoverRoutesWithSource(
    projectRoot,
    options.appUrl === undefined ? {} : { fallbackUrl: options.appUrl },
  );
  const config = await loadScopes(projectRoot, { routes: discovery.routes });

  if (discovery.source === "crawl" && options.appUrl !== undefined) {
    const count = discovery.routes.length;

    output.write(
      `Found ${count} ${count === 1 ? "route" : "routes"} by crawling ${options.appUrl}.\n`,
    );
  }

  if (options.scope !== undefined) {
    return {
      defaultScopeId: null,
      prompted: false,
      selection: selectionForScope(config, options.scope),
    };
  }

  const routes = discovery.routes;

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function relatedCitationText(finding: AuditFinding): string {
  return finding.related === undefined || finding.related.length === 0
    ? "None"
    : finding.related.join(", ");
}

function renderHtmlReport(
  summary: ScopeSummary,
  findings: readonly AuditFinding[],
  errors: readonly AuditCommandError[],
  reportPath: string,
  generatedAt: string,
): string {
  const findingItems =
    findings.length === 0
      ? "<p>No findings.</p>"
      : `<ol>${findings
          .map((finding) => {
            const screenshot = path
              .relative(path.dirname(reportPath), path.resolve(finding.evidence.screenshotPath))
              .split(path.sep)
              .join("/");

            return [
              "<li>",
              `<h2>${escapeHtml(finding.title)}</h2>`,
              `<p><strong>Page:</strong> ${escapeHtml(finding.page)}</p>`,
              `<p><strong>Citation:</strong> ${escapeHtml(finding.citation)}</p>`,
              `<p><strong>Related:</strong> ${escapeHtml(relatedCitationText(finding))}</p>`,
              `<p><strong>Severity:</strong> ${finding.severity}</p>`,
              `<p><strong>Selector:</strong> ${escapeHtml(finding.evidence.selector)}</p>`,
              `<p><strong>Measured:</strong> ${escapeHtml(finding.evidence.measuredValue)}</p>`,
              `<p><strong>Fix:</strong> ${escapeHtml(finding.fix)}</p>`,
              `<p><img src="${escapeHtml(screenshot)}" alt="Screenshot for ${escapeHtml(finding.evidence.selector)}"></p>`,
              "</li>",
            ].join("");
          })
          .join("")}</ol>`;
  const errorItems =
    errors.length === 0
      ? "<p>No check errors.</p>"
      : `<ul>${errors
          .map(
            (error) =>
              `<li>${escapeHtml(error.page)}: ${escapeHtml(error.check)} on ${escapeHtml(error.selector)}. ${escapeHtml(error.message)}</li>`,
          )
          .join("")}</ul>`;

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Fitting Room audit: ${escapeHtml(summary.name)}</title>`,
    "<style>",
    "body { margin: 0; padding: 32px; color: #16181d; background: #fff; font-family: system-ui, sans-serif; line-height: 1.5; }",
    "main { max-width: 880px; margin: 0 auto; }",
    "h1 { margin: 0 0 8px; }",
    "h2 { margin: 24px 0 8px; }",
    "li { margin-bottom: 32px; }",
    "img { max-width: 100%; border: 1px solid #d7d7d7; border-radius: 8px; }",
    "code { background: #f1f3f5; padding: 2px 4px; border-radius: 4px; }",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    `<h1>Fitting Room audit: ${escapeHtml(summary.name)}</h1>`,
    `<p><strong>Pages:</strong> ${escapeHtml(summary.pages.join(", "))}</p>`,
    `<p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>`,
    `<p><strong>Findings:</strong> ${findings.length}</p>`,
    findingItems,
    "<h2>Checks that hit errors</h2>",
    errorItems,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

export async function runAuditCommand(
  options: AuditCommandOptions = {},
): Promise<AuditCommandResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const output = options.output ?? process.stdout;
  const appUrl = options.appUrl ?? (await detectDevServer());

  if (appUrl === null) {
    throw new Error(
      "No local dev server found. Start your app or pass --url, for example: fitroom audit --url http://localhost:3000.",
    );
  }

  const selection = await selectAuditScope(options);

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
  const errors: AuditCommandError[] = [];
  const findings: AuditFinding[] = [];

  for (const page of captured.pages) {
    const report = await runAutomatedChecks(page.url, {
      outputDir: path.join(auditRoot, routeDirectoryName(page.path)),
    });

    findings.push(
      ...report.findings.map((finding) => ({
        ...finding,
        page: page.path,
      })),
    );
    errors.push(
      ...report.errors.map((error) => ({
        ...error,
        page: page.path,
      })),
    );
  }

  for (const finding of findings) {
    const validation = validate(finding);

    if (!validation.valid) {
      throw new Error(`Finding ${finding.id} is invalid: ${validation.errors.join(" ")}`);
    }
  }

  if (findings.length === 0) {
    output.write("Automated findings: 0.\n");
  } else {
    output.write(`Automated findings: ${findings.length}.\n`);

    for (const finding of findings) {
      const related =
        finding.related === undefined || finding.related.length === 0
          ? ""
          : ` Related: ${finding.related.join(", ")}.`;

      output.write(
        `- ${finding.page}: ${finding.title} [${finding.citation}], severity ${finding.severity}.${related}\n`,
      );
    }
  }

  output.write("Checks that hit errors:\n");

  if (errors.length === 0) {
    output.write("- None.\n");
  } else {
    for (const error of errors) {
      output.write(`- ${error.page}: ${error.check} on ${error.selector}. ${error.message}\n`);
    }
  }

  const reportRoot = path.resolve(auditRoot);
  const findingsPath = path.join(reportRoot, "findings.json");
  const reportPath = path.join(reportRoot, "report.html");
  const generatedAt = new Date().toISOString();

  await writeJsonAtomic(findingsPath, {
    scope: {
      id: captured.summary.id,
      name: captured.summary.name,
      pages: captured.summary.pages,
    },
    generatedAt,
    findings,
    errors,
  });
  await writeFileAtomic(
    reportPath,
    renderHtmlReport(captured.summary, findings, errors, reportPath, generatedAt),
  );

  output.write(`Findings JSON: ${findingsPath}\n`);
  output.write(`HTML report: ${reportPath}\n`);

  return {
    errors,
    findings,
    findingsPath,
    pages: captured.pages,
    reportPath,
    summary: captured.summary,
  };
}
