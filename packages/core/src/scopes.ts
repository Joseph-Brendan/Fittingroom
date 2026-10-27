import { stat } from "node:fs/promises";
import path from "node:path";
import { loadFitroomFile, writeFitroomJson } from "./fitroom-store";
import {
  type DiscoveredRoute,
  discoverRoutes,
  groupRoutes,
  PAGE_GROUPS,
  type PageGroup,
} from "./routes";

export const scopeNames: Record<PageGroup, string> = {
  marketing: "Marketing",
  auth: "Authentication",
  onboarding: "Onboarding",
  dashboard: "Dashboard",
  app: "App screens",
  settings: "Settings",
  checkout: "Checkout",
};

export interface ScopeDefinition {
  id: string;
  name: string;
  routes: string[];
}

export interface ScopesConfig {
  version: 1;
  scopes: ScopeDefinition[];
}

export interface LoadScopesOptions {
  fallbackUrl?: string;
  routes?: readonly DiscoveredRoute[];
}

export interface ScopeChecklistEntry extends ScopeDefinition {
  selected: boolean;
}

export type DefaultScopeSource = "dev-server" | "last-edited";

export interface DefaultScope {
  scope: ScopeDefinition;
  route: string;
  source: DefaultScopeSource;
}

export interface DefaultScopeContext {
  lastRequestedRoute?: string | null;
  lastEditedRoute?: string | null;
}

const authRouteOrder = ["/login", "/signup", "/forgot-password", "/verify", "/reset-password"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePagePath(value: string): string {
  let pathname = value.trim();

  if (/^[a-z]+:\/\//i.test(pathname)) {
    pathname = new URL(pathname).pathname;
  }

  const withoutQuery = pathname.split(/[?#]/)[0] ?? "/";
  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;

  return prefixed.length > 1 ? prefixed.replace(/\/+$/, "") : "/";
}

function sortRoutes(routes: readonly string[]): string[] {
  return [...routes].sort((first, second) => first.localeCompare(second));
}

function sortScopeRoutes(group: PageGroup, routes: readonly string[]): string[] {
  if (group !== "auth") {
    return sortRoutes(routes);
  }

  return [...routes].sort((first, second) => {
    const firstIndex = authRouteOrder.indexOf(first);
    const secondIndex = authRouteOrder.indexOf(second);

    if (firstIndex === -1 && secondIndex === -1) {
      return first.localeCompare(second);
    }

    if (firstIndex === -1) {
      return 1;
    }

    if (secondIndex === -1) {
      return -1;
    }

    return firstIndex - secondIndex;
  });
}

export function defaultScopes(routes: readonly DiscoveredRoute[]): ScopeDefinition[] {
  const grouped = groupRoutes(routes);
  const scopes: ScopeDefinition[] = [];

  for (const group of PAGE_GROUPS) {
    const routePaths = grouped[group].map((route) => route.path);

    if (routePaths.length === 0) {
      continue;
    }

    scopes.push({
      id: group,
      name: scopeNames[group],
      routes: sortScopeRoutes(group, routePaths),
    });
  }

  return scopes;
}

export function buildScopeChecklist(
  config: ScopesConfig,
  selectedScopeId?: string | null,
): ScopeChecklistEntry[] {
  return config.scopes.map((scope) => ({
    ...scope,
    selected: scope.id === selectedScopeId,
  }));
}

export function findScope(config: ScopesConfig, idOrName: string): ScopeDefinition | undefined {
  const normalized = idOrName.trim().toLowerCase();

  return config.scopes.find(
    (scope) => scope.id.toLowerCase() === normalized || scope.name.toLowerCase() === normalized,
  );
}

export function findScopeForRoutes(
  config: ScopesConfig,
  routes: readonly string[],
): ScopeDefinition | undefined {
  const normalized = routes.map(normalizePagePath);

  return config.scopes.find((scope) => normalized.every((route) => scope.routes.includes(route)));
}

export function resolveDefaultScope(
  config: ScopesConfig,
  context: DefaultScopeContext,
): DefaultScope | null {
  const candidates: Array<{ route: string | null | undefined; source: DefaultScopeSource }> = [
    { route: context.lastRequestedRoute, source: "dev-server" },
    { route: context.lastEditedRoute, source: "last-edited" },
  ];

  for (const candidate of candidates) {
    if (candidate.route === null || candidate.route === undefined) {
      continue;
    }

    const route = normalizePagePath(candidate.route);
    const scope = config.scopes.find((entry) => entry.routes.includes(route));

    if (scope !== undefined) {
      return { scope, route, source: candidate.source };
    }
  }

  return null;
}

export function scopeConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".fitroom", "scopes.json");
}

interface LastRequestFile {
  path: string | null;
}

function parseLastRequest(value: unknown): LastRequestFile {
  if (!isRecord(value) || (value.path !== null && typeof value.path !== "string")) {
    throw new Error("The last request file needs a path string or null.");
  }

  return {
    path: value.path === null ? null : normalizePagePath(value.path),
  };
}

export async function recordDevServerRequest(projectRoot: string, route: string): Promise<void> {
  await writeFitroomJson(projectRoot, "last-request.json", {
    path: normalizePagePath(route),
  });
}

export async function readDevServerLastRequest(projectRoot: string): Promise<string | null> {
  const file = await loadFitroomFile({
    projectRoot,
    fileName: "last-request.json",
    schema: parseLastRequest,
    defaultValue: () => ({ path: null }),
  });

  return file.path;
}

export async function findLastEditedRoute(
  projectRoot: string,
  routes: readonly DiscoveredRoute[],
): Promise<string | null> {
  let newest: { path: string; modified: number } | null = null;

  for (const route of routes) {
    try {
      const routeStat = await stat(path.join(projectRoot, route.file));

      if (
        newest === null ||
        routeStat.mtimeMs > newest.modified ||
        (routeStat.mtimeMs === newest.modified && route.path < newest.path)
      ) {
        newest = { path: route.path, modified: routeStat.mtimeMs };
      }
    } catch {}
  }

  return newest?.path ?? null;
}

export async function detectDefaultScope(
  projectRoot: string,
  config: ScopesConfig,
  routes: readonly DiscoveredRoute[],
  overrides: DefaultScopeContext = {},
): Promise<DefaultScope | null> {
  const lastRequestedRoute =
    overrides.lastRequestedRoute === undefined
      ? await readDevServerLastRequest(projectRoot)
      : overrides.lastRequestedRoute;
  const requestedLastEditedRoute = overrides.lastEditedRoute ?? null;
  const lastEditedRoute =
    requestedLastEditedRoute === null
      ? null
      : routes.some((route) => route.path === normalizePagePath(requestedLastEditedRoute))
        ? normalizePagePath(requestedLastEditedRoute)
        : null;

  return resolveDefaultScope(config, {
    lastRequestedRoute,
    lastEditedRoute,
  });
}

function validateScopes(value: unknown): ScopesConfig {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.scopes)) {
    throw new Error("Invalid .fitroom/scopes.json file.");
  }

  const ids = new Set<string>();
  const scopes = value.scopes.map((scope, index) => {
    if (!isRecord(scope)) {
      throw new Error(`Scope ${index + 1} must be an object.`);
    }

    const { id, name, routes } = scope;

    if (typeof id !== "string" || id.trim() === "") {
      throw new Error(`Scope ${index + 1} needs an id.`);
    }

    if (ids.has(id)) {
      throw new Error(`Scope id ${id} is repeated.`);
    }

    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`Scope ${id} needs a name.`);
    }

    if (
      !Array.isArray(routes) ||
      routes.length === 0 ||
      routes.some((route) => typeof route !== "string" || !route.startsWith("/"))
    ) {
      throw new Error(`Scope ${id} needs a list of route paths.`);
    }

    ids.add(id);

    return {
      id,
      name: name.trim(),
      routes: [...new Set(routes.map((route) => normalizePagePath(route)))],
    };
  });

  return { version: 1, scopes };
}

export async function loadScopes(
  projectRoot: string,
  options: LoadScopesOptions = {},
): Promise<ScopesConfig> {
  return loadFitroomFile({
    projectRoot,
    fileName: "scopes.json",
    schema: validateScopes,
    defaultValue: async () => {
      const routes =
        options.routes ??
        (await discoverRoutes(
          projectRoot,
          options.fallbackUrl === undefined ? {} : { fallbackUrl: options.fallbackUrl },
        ));

      return {
        version: 1,
        scopes: defaultScopes(routes),
      };
    },
  });
}

export async function saveScopes(projectRoot: string, config: ScopesConfig): Promise<ScopesConfig> {
  const validated = validateScopes(config);

  await writeFitroomJson(projectRoot, "scopes.json", validated);

  return validated;
}

export async function renameScope(
  projectRoot: string,
  scopeId: string,
  name: string,
): Promise<ScopesConfig> {
  const config = await loadScopes(projectRoot);
  const scope = findScope(config, scopeId);

  if (scope === undefined) {
    throw new Error(`Unknown scope ${scopeId}.`);
  }

  if (name.trim() === "") {
    throw new Error("A scope needs a name.");
  }

  scope.name = name.trim();

  return saveScopes(projectRoot, config);
}

export async function mergeScopes(
  projectRoot: string,
  targetId: string,
  sourceIds: readonly string[],
): Promise<ScopesConfig> {
  const config = await loadScopes(projectRoot);
  const target = findScope(config, targetId);

  if (target === undefined) {
    throw new Error(`Unknown scope ${targetId}.`);
  }

  const sources = sourceIds.map((sourceId) => {
    const source = findScope(config, sourceId);

    if (source === undefined) {
      throw new Error(`Unknown scope ${sourceId}.`);
    }

    return source;
  });
  const mergedRoutes = new Set(target.routes);
  const removedIds = new Set(sources.map((source) => source.id));

  for (const source of sources) {
    for (const route of source.routes) {
      mergedRoutes.add(route);
    }
  }

  target.routes = sortRoutes([...mergedRoutes]);
  removedIds.delete(target.id);
  config.scopes = config.scopes.filter((scope) => !removedIds.has(scope.id));

  return saveScopes(projectRoot, config);
}

export async function splitScope(
  projectRoot: string,
  sourceId: string,
  newScope: {
    id?: string;
    name: string;
    routes: readonly string[];
  },
): Promise<ScopesConfig> {
  const config = await loadScopes(projectRoot);
  const source = findScope(config, sourceId);

  if (source === undefined) {
    throw new Error(`Unknown scope ${sourceId}.`);
  }

  if (newScope.name.trim() === "") {
    throw new Error("A scope needs a name.");
  }

  const routes = [...new Set(newScope.routes.map((route) => normalizePagePath(route)))];

  if (routes.length === 0) {
    throw new Error("A split scope needs at least one page.");
  }

  if (!routes.every((route) => source.routes.includes(route))) {
    throw new Error(`Split pages must belong to ${source.name}.`);
  }

  if (source.routes.length === routes.length) {
    throw new Error("A split must leave at least one page in the original scope.");
  }

  const id =
    newScope.id?.trim() ||
    newScope.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  if (id === "" || findScope(config, id) !== undefined) {
    throw new Error(`A scope with the id ${id || newScope.name} already exists.`);
  }

  source.routes = source.routes.filter((route) => !routes.includes(route));
  const sourceIndex = config.scopes.findIndex((scope) => scope.id === source.id);

  config.scopes.splice(sourceIndex + 1, 0, {
    id,
    name: newScope.name.trim(),
    routes,
  });

  return saveScopes(projectRoot, config);
}
