import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  JsxAttribute,
  JsxElement,
  type JsxOpeningElement,
  JsxSelfClosingElement,
  Project,
  ScriptTarget,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  type DesignTokens,
  defaultTokensFile,
  type TokenCategory,
  type TokensFile,
} from "./design-system";
import { loadFitroomFile, writeFitroomJson, writeJsonAtomic } from "./fitroom-store";

export type InsertComponent = "heading" | "text" | "button" | "input" | "image";

export type EditOperation =
  | {
      op: "set-token";
      id: string;
      property: string;
      token: string;
    }
  | {
      op: "set-text";
      id: string;
      text: string;
    }
  | {
      op: "move";
      id: string;
      parent: string;
      index: number;
    }
  | {
      op: "delete";
      id: string;
    }
  | {
      op: "duplicate";
      id: string;
      newId: string;
    }
  | {
      op: "insert";
      parent: string;
      index?: number;
      component: InsertComponent;
      id: string;
      text?: string;
    }
  | {
      op: "swap-section";
      firstId: string;
      secondId: string;
    }
  | {
      op: "group";
      firstId: string;
      secondId: string;
      containerId: string;
    }
  | {
      op: "collapse";
      id: string;
      mode: "tab" | "accordion";
      containerId: string;
      label?: string;
    };

export interface EditOptions {
  projectRoot?: string;
  tokens?: DesignTokens;
  now?: () => Date;
}

export interface EditResult {
  offSystem: boolean;
  source: string;
}

interface EditLogEntry {
  operation: EditOperation;
  timestamp: string;
  offSystem: boolean;
}

interface EditFileLog {
  baseline: string;
  edits: EditLogEntry[];
}

interface EditLog {
  version: 1;
  files: Record<string, EditFileLog>;
}

type TargetElement = JsxElement | JsxSelfClosingElement;

const tokenPropertyCategories: Record<string, TokenCategory> = {
  color: "color",
  backgroundColor: "color",
  borderColor: "color",
  fill: "color",
  stroke: "color",
  margin: "space",
  marginBottom: "space",
  marginLeft: "space",
  marginRight: "space",
  marginTop: "space",
  padding: "space",
  paddingBottom: "space",
  paddingLeft: "space",
  paddingRight: "space",
  paddingTop: "space",
  gap: "space",
  rowGap: "space",
  columnGap: "space",
  borderRadius: "radius",
  fontFamily: "font",
  fontSize: "fontSize",
  boxShadow: "shadow",
};

function targetOpening(element: TargetElement): JsxOpeningElement | JsxSelfClosingElement {
  return element instanceof JsxElement ? element.getOpeningElement() : element;
}

function elementAttribute(element: TargetElement, name: string): JsxAttribute | undefined {
  const attribute = targetOpening(element).getAttribute(name);

  return attribute instanceof JsxAttribute ? attribute : undefined;
}

function elementId(element: TargetElement): string | undefined {
  const initializer = elementAttribute(element, "data-fr-id")?.getInitializer();

  if (initializer === undefined) {
    return undefined;
  }

  const text = initializer.getText();

  if (text.startsWith('"') || text.startsWith("'")) {
    return text.slice(1, -1);
  }

  return undefined;
}

function elementsIn(sourceFile: SourceFile): TargetElement[] {
  return [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
}

function findElement(sourceFile: SourceFile, id: string): TargetElement {
  const matches = elementsIn(sourceFile).filter((element) => elementId(element) === id);

  if (matches.length === 0) {
    throw new Error(`No element has data-fr-id ${id}.`);
  }

  if (matches.length > 1) {
    throw new Error(`More than one element has data-fr-id ${id}.`);
  }

  return matches[0] as TargetElement;
}

function childElements(parent: JsxElement): TargetElement[] {
  return parent
    .getJsxChildren()
    .filter(
      (child): child is TargetElement =>
        child instanceof JsxElement || child instanceof JsxSelfClosingElement,
    );
}

function parentElement(element: TargetElement): JsxElement | undefined {
  const parent = element.getParent();

  return parent instanceof JsxElement ? parent : undefined;
}

function writeChildren(parent: JsxElement, children: readonly TargetElement[]): void {
  parent.setBodyText(children.map((child) => child.getText()).join("\n"));
}

function newProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: 4,
      target: ScriptTarget.ES2022,
    },
  });
}

function formattedSource(sourceFile: SourceFile): string {
  sourceFile.formatText({
    convertTabsToSpaces: true,
    indentSize: 2,
  });

  return sourceFile.getFullText();
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function insertSnippet(component: InsertComponent, id: string, text?: string): string {
  const content = escapeText(text ?? "");

  switch (component) {
    case "heading":
      return `<h2 data-fr-id="${id}">${content || "Heading"}</h2>`;
    case "text":
      return `<p data-fr-id="${id}">${content || "Text"}</p>`;
    case "button":
      return `<button data-fr-id="${id}" type="button">${content || "Button"}</button>`;
    case "input":
      return `<input data-fr-id="${id}" type="text" />`;
    case "image":
      return `<img data-fr-id="${id}" src="${content}" alt="" />`;
  }
}

function resolveTokenValue(
  tokens: DesignTokens,
  property: string,
  token: string,
): { value: string; offSystem: boolean } {
  const parts = token.split(".");
  const explicitCategory = parts[0] as TokenCategory;
  const inferredCategory = tokenPropertyCategories[property];
  const category =
    parts.length > 1 &&
    ["color", "space", "radius", "font", "fontSize", "shadow"].includes(explicitCategory)
      ? explicitCategory
      : inferredCategory;

  if (category !== undefined) {
    const name = parts.length > 1 && parts[0] === category ? parts.slice(1).join(".") : token;
    const value = tokens[category][name];

    if (value !== undefined) {
      return { value, offSystem: false };
    }
  }

  return { value: token, offSystem: true };
}

function applyStyleToken(element: TargetElement, property: string, value: string): void {
  const opening = targetOpening(element);
  const styleAttribute = elementAttribute(element, "style");

  if (styleAttribute === undefined) {
    opening.addAttribute({
      initializer: `{{ ${property}: ${JSON.stringify(value)} }}`,
      name: "style",
    });
    return;
  }

  const initializer = styleAttribute.getInitializer();
  const object =
    initializer?.getKind() === SyntaxKind.JsxExpression
      ? initializer.getFirstChildByKind(SyntaxKind.ObjectLiteralExpression)
      : undefined;

  if (object === undefined) {
    styleAttribute.setInitializer(`{{ ${property}: ${JSON.stringify(value)} }}`);
    return;
  }

  const existing = object.getProperty(property);

  if (existing === undefined) {
    object.addPropertyAssignment({
      initializer: JSON.stringify(value),
      name: property,
    });
    return;
  }

  existing.replaceWithText(`${property}: ${JSON.stringify(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTokensFile(value: unknown): TokensFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.tokens)) {
    throw new Error("The tokens file needs version 1 and a tokens object.");
  }

  return value as unknown as TokensFile;
}

async function loadTokens(
  projectRoot: string,
  supplied: DesignTokens | undefined,
): Promise<DesignTokens> {
  if (supplied !== undefined) {
    return supplied;
  }

  const file = await loadFitroomFile({
    projectRoot,
    fileName: "tokens.json",
    schema: parseTokensFile,
    defaultValue: defaultTokensFile,
  });

  return file.tokens;
}

function applyOperation(
  sourceFile: SourceFile,
  operation: EditOperation,
  tokens: DesignTokens,
): boolean {
  switch (operation.op) {
    case "set-token": {
      const element = findElement(sourceFile, operation.id);
      const resolved = resolveTokenValue(tokens, operation.property, operation.token);

      applyStyleToken(element, operation.property, resolved.value);

      return resolved.offSystem;
    }

    case "set-text": {
      const element = findElement(sourceFile, operation.id);

      if (!(element instanceof JsxElement)) {
        throw new Error(`Element ${operation.id} cannot hold text.`);
      }

      element.setBodyTextInline(operation.text);
      return false;
    }

    case "move": {
      findElement(sourceFile, operation.id);
      const parent = findElement(sourceFile, operation.parent);

      if (!(parent instanceof JsxElement)) {
        throw new Error(`Element ${operation.parent} cannot hold children.`);
      }

      const children = childElements(parent);
      const index = children.findIndex((child) => elementId(child) === operation.id);

      if (index === -1) {
        throw new Error(`Element ${operation.id} is not a child of ${operation.parent}.`);
      }

      const [moved] = children.splice(index, 1);

      if (moved === undefined) {
        throw new Error(`Element ${operation.id} could not be moved.`);
      }

      children.splice(Math.max(0, Math.min(operation.index, children.length)), 0, moved);
      writeChildren(parent, children);
      return false;
    }

    case "delete": {
      const element = findElement(sourceFile, operation.id);
      const parent = parentElement(element);

      if (parent === undefined) {
        throw new Error(`Element ${operation.id} has no parent.`);
      }

      writeChildren(
        parent,
        childElements(parent).filter((child) => elementId(child) !== operation.id),
      );
      return false;
    }

    case "duplicate": {
      const element = findElement(sourceFile, operation.id);
      const parent = parentElement(element);

      if (parent === undefined) {
        throw new Error(`Element ${operation.id} has no parent.`);
      }

      if (elementsIn(sourceFile).some((candidate) => elementId(candidate) === operation.newId)) {
        throw new Error(`data-fr-id ${operation.newId} already exists.`);
      }

      const cloneText = element
        .getText()
        .replace(/data-fr-id=("[^"]*"|'[^']*')/, `data-fr-id="${operation.newId}"`);
      const children = childElements(parent);
      const index = children.findIndex((child) => elementId(child) === operation.id);

      if (index === -1) {
        throw new Error(`Element ${operation.id} could not be duplicated.`);
      }

      const childTexts = children.map((child) => child.getText());

      childTexts.splice(index + 1, 0, cloneText);
      parent.setBodyText(childTexts.join("\n"));
      return false;
    }

    case "insert": {
      const parent = findElement(sourceFile, operation.parent);

      if (!(parent instanceof JsxElement)) {
        throw new Error(`Element ${operation.parent} cannot hold children.`);
      }

      if (elementsIn(sourceFile).some((candidate) => elementId(candidate) === operation.id)) {
        throw new Error(`data-fr-id ${operation.id} already exists.`);
      }

      const snippet = insertSnippet(operation.component, operation.id, operation.text);
      const childTexts = childElements(parent).map((child) => child.getText());

      childTexts.splice(
        Math.max(0, Math.min(operation.index ?? childTexts.length, childTexts.length)),
        0,
        snippet,
      );
      parent.setBodyText(childTexts.join("\n"));
      return false;
    }

    case "group": {
      const first = findElement(sourceFile, operation.firstId);
      const second = findElement(sourceFile, operation.secondId);
      const parent = parentElement(first);

      if (parent === undefined || parentElement(second) !== parent) {
        throw new Error("Both blocks must share the same parent.");
      }

      if (elementsIn(sourceFile).some((element) => elementId(element) === operation.containerId)) {
        throw new Error(`data-fr-id ${operation.containerId} already exists.`);
      }

      const children = childElements(parent);
      const firstIndex = children.findIndex((child) => elementId(child) === operation.firstId);
      const secondIndex = children.findIndex((child) => elementId(child) === operation.secondId);

      if (firstIndex === -1 || secondIndex === -1) {
        throw new Error("Both blocks must be direct children of the same parent.");
      }

      const firstChild = children[firstIndex];
      const secondChild = children[secondIndex];

      if (firstChild === undefined || secondChild === undefined) {
        throw new Error("Could not group the blocks.");
      }

      const wrapper = `<div data-fr-id="${operation.containerId}">\n${firstChild.getText()}\n${secondChild.getText()}\n</div>`;
      const texts = children.map((child) => child.getText());
      const low = Math.min(firstIndex, secondIndex);
      const high = Math.max(firstIndex, secondIndex);

      texts.splice(high, 1);
      texts.splice(low, 1, wrapper);
      parent.setBodyText(texts.join("\n"));
      return false;
    }

    case "collapse": {
      const element = findElement(sourceFile, operation.id);
      const parent = parentElement(element);

      if (parent === undefined) {
        throw new Error(`Element ${operation.id} has no parent.`);
      }

      if (
        elementsIn(sourceFile).some((candidate) => elementId(candidate) === operation.containerId)
      ) {
        throw new Error(`data-fr-id ${operation.containerId} already exists.`);
      }

      const children = childElements(parent);
      const index = children.findIndex((child) => elementId(child) === operation.id);

      if (index === -1) {
        throw new Error(`Element ${operation.id} could not be collapsed.`);
      }

      const label = operation.label ?? "Show section";
      const wrapper = [
        `<div data-fr-id="${operation.containerId}">`,
        `<button type="button" aria-expanded="false" aria-controls="${operation.id}-panel" data-fr-collapse="${operation.mode}">${label}</button>`,
        `<div id="${operation.id}-panel" data-fr-collapse-panel="${operation.id}">`,
        element.getText(),
        "</div>",
        "</div>",
      ].join("\n");
      const texts = children.map((child) => child.getText());

      texts.splice(index, 1, wrapper);
      parent.setBodyText(texts.join("\n"));
      return false;
    }

    case "swap-section": {
      const first = findElement(sourceFile, operation.firstId);
      const second = findElement(sourceFile, operation.secondId);
      const parent = parentElement(first);

      if (parent === undefined || parentElement(second) !== parent) {
        throw new Error("Both sections must share the same parent.");
      }

      const children = childElements(parent);
      const firstIndex = children.findIndex((child) => elementId(child) === operation.firstId);
      const secondIndex = children.findIndex((child) => elementId(child) === operation.secondId);

      if (firstIndex === -1 || secondIndex === -1) {
        throw new Error("Both sections must be direct children of the same parent.");
      }

      const [firstChild] = children.splice(firstIndex, 1);

      if (firstChild === undefined) {
        throw new Error("Could not swap the first section.");
      }

      children.splice(secondIndex, 0, firstChild);
      writeChildren(parent, children);
      return false;
    }
  }
}

function parseEditLog(value: unknown): EditLog {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.files)) {
    throw new Error("The edits file needs version 1 and a files object.");
  }

  return value as unknown as EditLog;
}

async function loadLog(projectRoot: string): Promise<EditLog> {
  return loadFitroomFile({
    projectRoot,
    fileName: "edits.json",
    schema: parseEditLog,
    defaultValue: () => ({ version: 1, files: {} }),
  });
}

async function saveLog(projectRoot: string, log: EditLog): Promise<void> {
  await writeFitroomJson(projectRoot, "edits.json", log);
}

function logKey(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

export async function applyEdit(
  filePath: string,
  operation: EditOperation,
  options: EditOptions = {},
): Promise<EditResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const source = await readFile(filePath, "utf8");
  const tokens = await loadTokens(projectRoot, options.tokens);
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", source);
  const offSystem = applyOperation(sourceFile, operation, tokens);
  const formatted = formattedSource(sourceFile);
  const log = await loadLog(projectRoot);
  const key = logKey(projectRoot, filePath);
  const entry = log.files[key] ?? { baseline: source, edits: [] };
  const timestamp = (options.now?.() ?? new Date()).toISOString();

  await writeFile(filePath, formatted);

  entry.edits.push({ operation, timestamp, offSystem });
  log.files[key] = entry;
  await saveLog(projectRoot, log);

  return { offSystem, source: formatted };
}

export async function undoEdit(filePath: string, options: EditOptions = {}): Promise<EditResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const log = await loadLog(projectRoot);
  const key = logKey(projectRoot, filePath);
  const entry = log.files[key];

  if (entry === undefined || entry.edits.length === 0) {
    throw new Error(`No edits to undo for ${key}.`);
  }

  const tokens = await loadTokens(projectRoot, options.tokens);
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", entry.baseline);
  let offSystem = false;

  for (const edit of entry.edits.slice(0, -1)) {
    offSystem = applyOperation(sourceFile, edit.operation, tokens) || offSystem;
  }

  const formatted = formattedSource(sourceFile);

  await writeFile(filePath, formatted);
  entry.edits.pop();
  log.files[key] = entry;
  await saveLog(projectRoot, log);

  return { offSystem, source: formatted };
}

export interface VariantEditOptions {
  now?: () => Date;
  projectRoot?: string;
  slug: string;
  tokens?: DesignTokens;
}

export interface VariantStampResult {
  ids: string[];
  source: string;
}

interface VariantEditLog {
  version: 1;
  slug: string;
  baseline: string;
  edits: EditLogEntry[];
  redo: EditLogEntry[];
}

function safeSlug(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`The variant slug ${slug} must be lowercase and hyphenated.`);
  }

  return slug;
}

function variantLogPath(projectRoot: string, slug: string): string {
  return path.join(projectRoot, ".fitroom", "edits", `${safeSlug(slug)}.json`);
}

function variantOrigPath(projectRoot: string, slug: string): string {
  return path.join(projectRoot, ".fitroom", "variants", `${safeSlug(slug)}.orig.tsx`);
}

function jsxTagName(element: TargetElement): string {
  const tag =
    element instanceof JsxElement
      ? element.getOpeningElement().getTagNameNode().getText()
      : element.getTagNameNode().getText();
  const normalized = tag
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized === "" ? "element" : normalized;
}

export async function stampVariantFile(filePath: string): Promise<VariantStampResult> {
  const source = await readFile(filePath, "utf8");
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", source);
  const elements = elementsIn(sourceFile).sort(
    (first, second) => first.getStart() - second.getStart(),
  );
  const used = new Set(
    elements.flatMap((element) => {
      const id = elementId(element);

      return id === undefined ? [] : [id];
    }),
  );
  const ids: string[] = [];
  const counters = new Map<string, number>();

  for (const element of elements) {
    const existing = elementId(element);

    if (existing !== undefined) {
      ids.push(existing);
      continue;
    }

    const tag = jsxTagName(element);
    let count = counters.get(tag) ?? 0;
    let id = `fr-${tag}-${count + 1}`;

    while (used.has(id)) {
      count += 1;
      id = `fr-${tag}-${count + 1}`;
    }

    counters.set(tag, count + 1);
    used.add(id);
    ids.push(id);
    targetOpening(element).addAttribute({
      initializer: JSON.stringify(id),
      name: "data-fr-id",
    });
  }

  const formatted = formattedSource(sourceFile);

  await writeFile(filePath, formatted);

  return { ids, source: formatted };
}

function isVariantEditLog(value: unknown): value is VariantEditLog {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.slug === "string" &&
    typeof value.baseline === "string" &&
    Array.isArray(value.edits) &&
    Array.isArray(value.redo)
  );
}

async function readVariantLog(projectRoot: string, slug: string): Promise<VariantEditLog | null> {
  try {
    const raw = JSON.parse(await readFile(variantLogPath(projectRoot, slug), "utf8")) as unknown;

    if (!isVariantEditLog(raw)) {
      throw new Error("The edit log has the wrong shape.");
    }

    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeVariantLog(
  projectRoot: string,
  slug: string,
  log: VariantEditLog,
): Promise<void> {
  await writeJsonAtomic(variantLogPath(projectRoot, slug), log);
}

function replayVariant(
  source: string,
  entries: readonly EditLogEntry[],
  tokens: DesignTokens,
): string {
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", source);

  for (const entry of entries) {
    applyOperation(sourceFile, entry.operation, tokens);
  }

  return formattedSource(sourceFile);
}

async function ensureVariantBaseline(
  projectRoot: string,
  slug: string,
  currentSource: string,
  log: VariantEditLog | null,
): Promise<{ log: VariantEditLog; source: string }> {
  if (log !== null) {
    return { log, source: log.baseline };
  }

  const origPath = variantOrigPath(projectRoot, slug);

  await mkdir(path.dirname(origPath), { recursive: true });

  try {
    const baseline = await readFile(origPath, "utf8");

    return {
      log: { version: 1, slug, baseline, edits: [], redo: [] },
      source: baseline,
    };
  } catch {
    await writeFile(origPath, currentSource);

    return {
      log: { version: 1, slug, baseline: currentSource, edits: [], redo: [] },
      source: currentSource,
    };
  }
}

export async function applyVariantEdit(
  filePath: string,
  operation: EditOperation,
  options: VariantEditOptions,
): Promise<EditResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const slug = safeSlug(options.slug);
  const source = await readFile(filePath, "utf8");
  const tokens = await loadTokens(projectRoot, options.tokens);
  const current = await readVariantLog(projectRoot, slug);
  const ensured = await ensureVariantBaseline(projectRoot, slug, source, current);
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", source);
  const offSystem = applyOperation(sourceFile, operation, tokens);
  const formatted = formattedSource(sourceFile);
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const log = ensured.log;

  log.edits.push({ operation, timestamp, offSystem });
  log.redo = [];

  await writeFile(filePath, formatted);
  await writeVariantLog(projectRoot, slug, log);

  return { offSystem, source: formatted };
}

export async function undoVariantEdit(
  filePath: string,
  options: VariantEditOptions,
): Promise<EditResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const slug = safeSlug(options.slug);
  const log = await readVariantLog(projectRoot, slug);

  if (log === null || log.edits.length === 0) {
    throw new Error(`No edits to undo for ${slug}.`);
  }

  const entry = log.edits.pop();

  if (entry === undefined) {
    throw new Error(`No edits to undo for ${slug}.`);
  }

  log.redo.push(entry);
  const tokens = await loadTokens(projectRoot, options.tokens);
  const formatted = replayVariant(log.baseline, log.edits, tokens);

  await writeFile(filePath, formatted);
  await writeVariantLog(projectRoot, slug, log);

  return { offSystem: log.edits.some((edit) => edit.offSystem), source: formatted };
}

export async function redoVariantEdit(
  filePath: string,
  options: VariantEditOptions,
): Promise<EditResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const slug = safeSlug(options.slug);
  const log = await readVariantLog(projectRoot, slug);

  if (log === null || log.redo.length === 0) {
    throw new Error(`No edits to redo for ${slug}.`);
  }

  const entry = log.redo.pop();

  if (entry === undefined) {
    throw new Error(`No edits to redo for ${slug}.`);
  }

  log.edits.push(entry);
  const tokens = await loadTokens(projectRoot, options.tokens);
  const formatted = replayVariant(log.baseline, log.edits, tokens);

  await writeFile(filePath, formatted);
  await writeVariantLog(projectRoot, slug, log);

  return { offSystem: log.edits.some((edit) => edit.offSystem), source: formatted };
}

export async function saveVariantOriginal(
  filePath: string,
  options: { projectRoot?: string; slug: string },
): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const origPath = variantOrigPath(projectRoot, options.slug);

  await mkdir(path.dirname(origPath), { recursive: true });
  await copyFile(filePath, origPath);

  return origPath;
}
