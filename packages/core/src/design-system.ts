import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFitroomJson } from "./fitroom-store";

export const tokenCategories = ["color", "space", "radius", "font", "fontSize", "shadow"] as const;

export type TokenCategory = (typeof tokenCategories)[number];
export type DesignSystemStatus = "connected" | "partial" | "none";
export type DesignTokens = Record<TokenCategory, Record<string, string>>;

export interface DesignSystemInfo {
  status: DesignSystemStatus;
  sources: string[];
  tokens: DesignTokens;
  components: string[];
  missing: TokenCategory[];
}

export interface TokensFile {
  version: 1;
  status: Exclude<DesignSystemStatus, "connected">;
  tokens: DesignTokens;
  missing: TokenCategory[];
}

export function defaultTokensFile(): TokensFile {
  return {
    version: 1,
    status: "none",
    tokens: emptyDesignTokens(),
    missing: [...tokenCategories],
  };
}

const skipDirectories = new Set([
  ".git",
  ".next",
  ".fitroom",
  "dist",
  "build",
  "coverage",
  "node_modules",
]);

const shadcnColorTokens = new Set([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]);

export function emptyDesignTokens(): DesignTokens {
  return {
    color: {},
    space: {},
    radius: {},
    font: {},
    fontSize: {},
    shadow: {},
  };
}

async function readPackageDependencies(projectRoot: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    const dependencies = raw.dependencies;
    const devDependencies = raw.devDependencies;

    return {
      ...(typeof dependencies === "object" && dependencies !== null
        ? (dependencies as Record<string, string>)
        : {}),
      ...(typeof devDependencies === "object" && devDependencies !== null
        ? (devDependencies as Record<string, string>)
        : {}),
    };
  } catch {
    return {};
  }
}

async function collectFiles(directory: string, root: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (skipDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, root)));
      continue;
    }

    files.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }

  return files;
}

function tokenValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => tokenValue(entry))
      .filter((entry) => entry !== null)
      .join(", ");
  }

  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return null;
}

function addToken(
  tokens: DesignTokens,
  category: TokenCategory,
  name: string,
  value: string,
): void {
  const normalizedName = name.trim();

  if (normalizedName === "") {
    return;
  }

  tokens[category][normalizedName] = value;
}

function addCssVariable(tokens: DesignTokens, name: string, value: string): boolean {
  const normalized = tokenValue(value);

  if (normalized === null) {
    return false;
  }

  if (name.startsWith("color-")) {
    addToken(tokens, "color", name.slice("color-".length), normalized);
    return true;
  }

  if (name.startsWith("space-") || name.startsWith("spacing-")) {
    const prefix = name.startsWith("space-") ? "space-" : "spacing-";
    addToken(tokens, "space", name.slice(prefix.length), normalized);
    return true;
  }

  if (name.startsWith("radius")) {
    const rest = name.slice("radius".length).replace(/^-/, "");
    addToken(tokens, "radius", rest === "" ? "default" : rest, normalized);
    return true;
  }

  if (name.startsWith("font-size-")) {
    addToken(tokens, "fontSize", name.slice("font-size-".length), normalized);
    return true;
  }

  if (name.startsWith("text-")) {
    addToken(tokens, "fontSize", name.slice("text-".length), normalized);
    return true;
  }

  if (name.startsWith("font-")) {
    addToken(tokens, "font", name.slice("font-".length), normalized);
    return true;
  }

  if (name.startsWith("shadow-")) {
    addToken(tokens, "shadow", name.slice("shadow-".length), normalized);
    return true;
  }

  return false;
}

function extractCssBlocks(css: string, pattern: RegExp): string[] {
  return [...css.matchAll(pattern)].map((match) => match[1] ?? "");
}

function parseCssVariables(block: string): Array<[string, string]> {
  return [...block.matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [
    match[1] ?? "",
    (match[2] ?? "").trim(),
  ]);
}

function flattenTokens(value: unknown, prefix: string, target: Record<string, string>): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const normalized = tokenValue(value);

    if (normalized !== null && prefix !== "") {
      target[prefix] = normalized;
    }

    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    flattenTokens(entry, prefix === "" ? key : `${prefix}.${key}`, target);
  }
}

function parseTailwindObject(source: string): Record<string, unknown> | null {
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const objectSource = source.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(objectSource) as Record<string, unknown>;
  } catch {
    const normalized = objectSource
      .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
      .replace(/,(\s*[}\]])/g, "$1");

    try {
      return JSON.parse(normalized) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function collectTailwindV3Tokens(config: Record<string, unknown>, tokens: DesignTokens): void {
  const theme =
    typeof config.theme === "object" && config.theme !== null
      ? (config.theme as Record<string, unknown>)
      : {};
  const resolved =
    typeof theme.extend === "object" && theme.extend !== null
      ? (theme.extend as Record<string, unknown>)
      : theme;
  const categories: Array<[string, TokenCategory]> = [
    ["colors", "color"],
    ["spacing", "space"],
    ["borderRadius", "radius"],
    ["fontFamily", "font"],
    ["fontSize", "fontSize"],
    ["boxShadow", "shadow"],
  ];

  for (const [key, category] of categories) {
    const values = resolved[key];

    if (typeof values !== "object" || values === null) {
      continue;
    }

    flattenTokens(values, "", tokens[category]);
  }
}

function collectDtcgTokens(value: unknown, pathParts: string[], tokens: DesignTokens): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.$value !== "undefined" && typeof record.$type === "string") {
    const normalized = tokenValue(record.$value);

    if (normalized === null) {
      return false;
    }

    const type = record.$type;
    let category: TokenCategory | null = null;

    if (type === "color") {
      category = "color";
    } else if (type === "fontFamily") {
      category = "font";
    } else if (type === "fontSize") {
      category = "fontSize";
    } else if (type === "shadow") {
      category = "shadow";
    } else if (type === "dimension") {
      if (pathParts.includes("radius")) {
        category = "radius";
      } else if (pathParts.includes("space") || pathParts.includes("spacing")) {
        category = "space";
      }
    }

    if (category !== null) {
      const nameParts = pathParts[0] === category ? pathParts.slice(1) : pathParts;
      addToken(tokens, category, nameParts.join("."), normalized);
      return true;
    }

    return false;
  }

  let found = false;

  for (const [key, entry] of Object.entries(record)) {
    if (key.startsWith("$")) {
      continue;
    }

    found = collectDtcgTokens(entry, [...pathParts, key], tokens) || found;
  }

  return found;
}

function addComponentLibrarySources(
  dependencies: Record<string, string>,
  sources: string[],
  components: string[],
): void {
  const libraries: Array<[string, string, string]> = [
    ["@mui/material", "mui", "MUI"],
    ["@chakra-ui/react", "chakra", "Chakra UI"],
    ["@mantine/core", "mantine", "Mantine"],
    ["@radix-ui/themes", "radix-themes", "Radix Themes"],
    ["antd", "ant-design", "Ant Design"],
  ];

  for (const [dependency, source, component] of libraries) {
    if (dependencies[dependency] !== undefined) {
      sources.push(source);
      components.push(component);
    }
  }
}

async function shadcnComponents(projectRoot: string): Promise<string[]> {
  const directory = path.join(projectRoot, "components", "ui");

  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.basename(entry.name, path.extname(entry.name)))
      .sort();
  } catch {
    return [];
  }
}

async function writeMissingTokens(
  projectRoot: string,
  status: Exclude<DesignSystemStatus, "connected">,
  tokens: DesignTokens,
  missing: TokenCategory[],
): Promise<void> {
  const file: TokensFile = {
    version: 1,
    status,
    tokens,
    missing,
  };

  await writeFitroomJson(projectRoot, "tokens.json", file);
}

export async function detectDesignSystem(projectRoot: string): Promise<DesignSystemInfo> {
  const tokens = emptyDesignTokens();
  const sources: string[] = [];
  const components: string[] = [];
  const files = await collectFiles(projectRoot, projectRoot);
  const cssFiles = files.filter((file) => file.endsWith(".css"));
  const jsonFiles = files.filter(
    (file) =>
      file.endsWith(".json") &&
      file !== "package.json" &&
      file !== "components.json" &&
      !file.startsWith("tsconfig"),
  );
  const dependencies = await readPackageDependencies(projectRoot);
  const tailwindConfigNames = [
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
  ];
  const tailwindConfigName = tailwindConfigNames.find((name) => files.includes(name));
  let usedTailwindV4 = false;

  for (const file of cssFiles) {
    const css = await readFile(path.join(projectRoot, file), "utf8");
    const themeBlocks = extractCssBlocks(css, /@theme\s*\{([\s\S]*?)\}/g);

    if (themeBlocks.length > 0) {
      usedTailwindV4 = true;

      for (const block of themeBlocks) {
        for (const [name, value] of parseCssVariables(block)) {
          addCssVariable(tokens, name, value);
        }
      }
    }

    const rootBlocks = extractCssBlocks(css, /:root\s*\{([\s\S]*?)\}/g);

    for (const block of rootBlocks) {
      for (const [name, value] of parseCssVariables(block)) {
        const isRecognized = addCssVariable(tokens, name, value);

        if (isRecognized) {
          sources.push("css-variables");
        }
      }
    }
  }

  if (usedTailwindV4) {
    sources.push("tailwind-v4");
  }

  if (tailwindConfigName !== undefined) {
    sources.push("tailwind-v3");
    const configSource = await readFile(path.join(projectRoot, tailwindConfigName), "utf8");
    const config = parseTailwindObject(configSource);

    if (config !== null) {
      collectTailwindV3Tokens(config, tokens);
    }
  }

  let usedDtcg = false;

  for (const file of jsonFiles) {
    try {
      const raw = JSON.parse(await readFile(path.join(projectRoot, file), "utf8")) as unknown;

      usedDtcg = collectDtcgTokens(raw, [], tokens) || usedDtcg;
    } catch {}
  }

  if (usedDtcg) {
    sources.push("dtcg");
  }

  if (files.includes("components.json")) {
    sources.push("shadcn");
    components.push(...(await shadcnComponents(projectRoot)));

    for (const file of cssFiles) {
      const css = await readFile(path.join(projectRoot, file), "utf8");

      for (const block of extractCssBlocks(css, /:root\s*\{([\s\S]*?)\}/g)) {
        for (const [name, value] of parseCssVariables(block)) {
          const normalized = tokenValue(value);

          if (normalized === null) {
            continue;
          }

          if (shadcnColorTokens.has(name)) {
            addToken(tokens, "color", name, normalized);
          }
        }
      }
    }
  }

  addComponentLibrarySources(dependencies, sources, components);

  const uniqueSources = [...new Set(sources)];
  const missing = tokenCategories.filter((category) => Object.keys(tokens[category]).length === 0);
  const status: DesignSystemStatus =
    uniqueSources.length === 0 ? "none" : missing.length === 0 ? "connected" : "partial";

  if (status !== "connected") {
    await writeMissingTokens(projectRoot, status, tokens, missing);
  }

  return {
    status,
    sources: uniqueSources,
    tokens,
    components,
    missing,
  };
}
