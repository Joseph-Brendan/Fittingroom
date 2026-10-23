import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

export const PAGE_GROUPS = [
  "marketing",
  "auth",
  "onboarding",
  "dashboard",
  "app",
  "settings",
  "checkout",
] as const;

export type PageGroup = (typeof PAGE_GROUPS)[number];

export interface DiscoveredRoute {
  path: string;
  file: string;
  segments: string[];
  routeGroups: string[];
  layouts: string[];
}

export type GroupedRoutes = Record<PageGroup, DiscoveredRoute[]>;

export interface RouteDiscoveryOptions {
  fallbackUrl?: string;
  maxPages?: number;
}

export interface RouteDiscoveryResult {
  routes: DiscoveredRoute[];
  source: "app-router" | "crawl";
}

const pageFilePattern = /^page\.(?:tsx|ts|jsx|js|mdx)$/;
const layoutFilePattern = /^layout\.(?:tsx|ts|jsx|js)$/;

const groupAliases: Record<PageGroup, readonly string[]> = {
  marketing: [
    "marketing",
    "site",
    "landing",
    "home",
    "pricing",
    "features",
    "feature",
    "blog",
    "about",
    "contact",
    "product",
    "products",
    "customers",
    "enterprise",
  ],
  auth: [
    "auth",
    "authentication",
    "login",
    "log-in",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "register",
    "registration",
    "password",
    "forgot-password",
    "reset-password",
    "verify-email",
  ],
  onboarding: ["onboarding", "welcome", "setup", "get-started", "start", "intro", "tour"],
  dashboard: ["dashboard", "overview", "analytics", "insights", "stats", "metrics"],
  app: [
    "app",
    "application",
    "projects",
    "project",
    "workspace",
    "workspaces",
    "reports",
    "report",
    "files",
    "documents",
    "inbox",
    "editor",
    "board",
    "boards",
  ],
  settings: ["settings", "setting", "preferences", "preference", "account", "profile"],
  checkout: [
    "checkout",
    "cart",
    "payment",
    "payments",
    "order",
    "orders",
    "purchase",
    "billing",
    "subscribe",
    "subscription",
  ],
};

const groupPriority: PageGroup[] = [
  "checkout",
  "settings",
  "auth",
  "onboarding",
  "dashboard",
  "app",
  "marketing",
];

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function findAppDirectory(projectRoot: string): Promise<string | null> {
  for (const candidate of ["app", "src/app"]) {
    const candidatePath = path.join(projectRoot, candidate);

    try {
      const candidateStat = await stat(candidatePath);

      if (candidateStat.isDirectory()) {
        return candidatePath;
      }
    } catch {}
  }

  return null;
}

async function collectRouteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name.startsWith(".") ||
      entry.name.startsWith("_")
    ) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectRouteFiles(entryPath)));
      continue;
    }

    if (pageFilePattern.test(entry.name) || layoutFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function sortRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  return routes.sort((first, second) => {
    if (first.path === "/") {
      return -1;
    }

    if (second.path === "/") {
      return 1;
    }

    return first.path.localeCompare(second.path);
  });
}

async function discoverAppRoutes(
  projectRoot: string,
  appDirectory: string,
): Promise<DiscoveredRoute[]> {
  const routeFiles = await collectRouteFiles(appDirectory);
  const layoutByDirectory = new Map<string, string>();
  const pageFiles: string[] = [];

  for (const file of routeFiles) {
    const directory = toPosix(path.relative(appDirectory, path.dirname(file)));
    const relativeFile = toPosix(path.relative(projectRoot, file));

    if (layoutFilePattern.test(path.basename(file))) {
      layoutByDirectory.set(directory, relativeFile);
      continue;
    }

    pageFiles.push(file);
  }

  const routes = pageFiles.map((file) => {
    const pageDirectory = toPosix(path.relative(appDirectory, path.dirname(file)));
    const directoryParts = pageDirectory === "" ? [] : pageDirectory.split("/");
    const segments = directoryParts.filter((segment) => !isRouteGroup(segment));
    const routeGroups = directoryParts
      .filter((segment) => isRouteGroup(segment))
      .map((segment) => segment.slice(1, -1));
    const layouts: string[] = [];
    const rootLayout = layoutByDirectory.get("");

    if (rootLayout !== undefined) {
      layouts.push(rootLayout);
    }

    let currentDirectory = "";

    for (const part of directoryParts) {
      currentDirectory = currentDirectory === "" ? part : `${currentDirectory}/${part}`;
      const layout = layoutByDirectory.get(currentDirectory);

      if (layout !== undefined) {
        layouts.push(layout);
      }
    }

    return {
      path: segments.length === 0 ? "/" : `/${segments.join("/")}`,
      file: toPosix(path.relative(projectRoot, file)),
      segments,
      routeGroups,
      layouts,
    };
  });

  return sortRoutes(routes);
}

function routeFromPath(routePath: string): DiscoveredRoute {
  const segments =
    routePath === "/"
      ? []
      : routePath
          .replace(/^\/+|\/+$/g, "")
          .split("/")
          .filter((segment) => segment !== "");

  return {
    path: routePath,
    file: routePath,
    segments,
    routeGroups: [],
    layouts: [],
  };
}

function normalizeCrawlPath(url: URL): string {
  const pathname = url.pathname;

  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
}

async function crawlRoutes(startUrl: string, maxPages: number): Promise<DiscoveredRoute[]> {
  const start = new URL(startUrl);
  const origin = start.origin;
  const queue: string[] = [];
  const queued = new Set<string>();
  const seen = new Set<string>();
  const routes: DiscoveredRoute[] = [];
  const first = new URL(start.toString());

  first.hash = "";
  first.search = "";
  queue.push(first.toString());
  queued.add(first.toString());

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    try {
      while (queue.length > 0 && routes.length < maxPages) {
        const next = queue.shift();

        if (next === undefined || seen.has(next)) {
          continue;
        }

        seen.add(next);

        let contentType = "";

        try {
          const response = await page.goto(next, { waitUntil: "load" });

          contentType = response?.headers()["content-type"] ?? "";
        } catch {
          continue;
        }

        if (!contentType.includes("text/html")) {
          continue;
        }

        const current = new URL(page.url());

        if (current.origin !== origin) {
          continue;
        }

        const routePath = normalizeCrawlPath(current);

        if (!routes.some((route) => route.path === routePath)) {
          routes.push(routeFromPath(routePath));
        }

        const hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
            (anchor) => anchor.href,
          ),
        );

        for (const href of hrefs) {
          let link: URL;

          try {
            link = new URL(href);
          } catch {
            continue;
          }

          if (link.origin !== origin || (link.protocol !== "http:" && link.protocol !== "https:")) {
            continue;
          }

          link.hash = "";
          link.search = "";
          const normalized = link.toString();

          if (!queued.has(normalized)) {
            queued.add(normalized);
            queue.push(normalized);
          }
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return sortRoutes(routes);
}

export async function discoverRoutesWithSource(
  projectRoot: string,
  options: RouteDiscoveryOptions = {},
): Promise<RouteDiscoveryResult> {
  const appDirectory = await findAppDirectory(projectRoot);

  if (appDirectory !== null) {
    return {
      routes: await discoverAppRoutes(projectRoot, appDirectory),
      source: "app-router",
    };
  }

  if (options.fallbackUrl !== undefined) {
    return {
      routes: await crawlRoutes(options.fallbackUrl, options.maxPages ?? 50),
      source: "crawl",
    };
  }

  throw new Error("No Next.js App Router folder found. Add an app or src/app folder.");
}

export async function discoverRoutes(
  projectRoot: string,
  options: RouteDiscoveryOptions = {},
): Promise<DiscoveredRoute[]> {
  return (await discoverRoutesWithSource(projectRoot, options)).routes;
}

function addToken(tokens: Set<string>, value: string): void {
  const normalized = value.trim().toLowerCase();

  if (normalized !== "" && normalized !== "app" && normalized !== "src") {
    tokens.add(normalized);
  }
}

function collectTokens(route: DiscoveredRoute): Set<string> {
  const tokens = new Set<string>();

  for (const routeGroup of route.routeGroups) {
    addToken(tokens, routeGroup);
  }

  for (const segment of route.segments) {
    addToken(tokens, segment);
  }

  for (const location of [route.file, ...route.layouts]) {
    for (const part of location.split("/")) {
      if (isRouteGroup(part)) {
        addToken(tokens, part.slice(1, -1));
        continue;
      }

      if (!part.includes(".")) {
        addToken(tokens, part);
      }
    }
  }

  return tokens;
}

function groupForRoute(route: DiscoveredRoute): PageGroup {
  const declaredGroup = groupPriority.find((group) =>
    route.routeGroups.some(
      (routeGroup) =>
        groupAliases[group].includes(routeGroup) || routeGroup.toLowerCase() === group,
    ),
  );

  if (declaredGroup !== undefined) {
    return declaredGroup;
  }

  const tokens = collectTokens(route);
  const namedGroup = groupPriority.find((group) =>
    groupAliases[group].some((alias) => tokens.has(alias)),
  );

  if (namedGroup !== undefined) {
    return namedGroup;
  }

  return route.path === "/" ? "marketing" : "app";
}

export function groupRoutes(routes: readonly DiscoveredRoute[]): GroupedRoutes {
  const grouped = Object.fromEntries(
    PAGE_GROUPS.map((group) => [group, [] as DiscoveredRoute[]]),
  ) as GroupedRoutes;

  for (const route of routes) {
    grouped[groupForRoute(route)].push(route);
  }

  for (const group of PAGE_GROUPS) {
    sortRoutes(grouped[group]);
  }

  return grouped;
}
