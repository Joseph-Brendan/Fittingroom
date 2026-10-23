import {
  loadScopes,
  mergeScopes,
  normalizePagePath,
  renameScope,
  type ScopesConfig,
  splitScope,
} from "@fittingroom/core";

export interface ScopesCommandOptions {
  projectRoot?: string;
  output?: NodeJS.WritableStream;
}

function scopeText(config: ScopesConfig): string {
  return [
    "Available scopes:",
    ...config.scopes.map(
      (scope) =>
        `- ${scope.id}: ${scope.name} (${scope.routes.length} pages): ${scope.routes.join(" ")}`,
    ),
  ].join("\n");
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function remainingArgs(args: readonly string[]): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === undefined) {
      continue;
    }

    if (value === "--name" || value === "--pages" || value === "--id") {
      index += 1;
      continue;
    }

    if (value.startsWith("--")) {
      continue;
    }

    values.push(value);
  }

  return values;
}

export async function runScopesCommand(
  args: readonly string[],
  options: ScopesCommandOptions = {},
): Promise<void> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const output = options.output ?? process.stdout;
  const [action = "list", ...rest] = args;

  if (action === "list") {
    output.write(`${scopeText(await loadScopes(projectRoot))}\n`);
    return;
  }

  if (action === "rename") {
    const [scopeId, ...nameParts] = remainingArgs(rest);
    const name = nameParts.join(" ").trim();

    if (scopeId === undefined || name === "") {
      throw new Error("Usage: fitroom scopes rename <scope> <name>");
    }

    const config = await renameScope(projectRoot, scopeId, name);

    output.write(`${scopeText(config)}\n`);
    return;
  }

  if (action === "merge") {
    const [targetId, ...sourceIds] = remainingArgs(rest);

    if (targetId === undefined || sourceIds.length === 0) {
      throw new Error("Usage: fitroom scopes merge <target> <source...>");
    }

    const config = await mergeScopes(projectRoot, targetId, sourceIds);

    output.write(`${scopeText(config)}\n`);
    return;
  }

  if (action === "split") {
    const [sourceId] = remainingArgs(rest);
    const name = optionValue(rest, "--name")?.trim();
    const pages = optionValue(rest, "--pages");
    const id = optionValue(rest, "--id")?.trim();

    if (sourceId === undefined || name === undefined || name === "" || pages === undefined) {
      throw new Error(
        "Usage: fitroom scopes split <scope> --name <name> --pages /one,/two [--id <id>]",
      );
    }

    const routes = pages
      .split(",")
      .map((page) => normalizePagePath(page))
      .filter((page) => page !== "");

    const config = await splitScope(projectRoot, sourceId, {
      ...(id === undefined || id === "" ? {} : { id }),
      name,
      routes,
    });

    output.write(`${scopeText(config)}\n`);
    return;
  }

  throw new Error(`Unknown scopes command ${action}.`);
}
