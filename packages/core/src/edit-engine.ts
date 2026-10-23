import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import type { DesignTokens, TokenCategory } from "./design-system";

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

async function loadTokens(
  projectRoot: string,
  supplied: DesignTokens | undefined,
): Promise<DesignTokens> {
  if (supplied !== undefined) {
    return supplied;
  }

  try {
    const raw = JSON.parse(
      await readFile(path.join(projectRoot, ".fittingroom", "tokens.json"), "utf8"),
    ) as { tokens?: DesignTokens };

    if (raw.tokens !== undefined) {
      return raw.tokens;
    }
  } catch {
    return {
      color: {},
      space: {},
      radius: {},
      font: {},
      fontSize: {},
      shadow: {},
    };
  }

  return {
    color: {},
    space: {},
    radius: {},
    font: {},
    fontSize: {},
    shadow: {},
  };
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

function editLogPath(projectRoot: string): string {
  return path.join(projectRoot, ".fittingroom", "edits.json");
}

async function loadLog(projectRoot: string): Promise<EditLog> {
  try {
    const raw = JSON.parse(await readFile(editLogPath(projectRoot), "utf8")) as EditLog;

    if (raw.version === 1 && typeof raw.files === "object" && raw.files !== null) {
      return raw;
    }
  } catch {
    return { version: 1, files: {} };
  }

  return { version: 1, files: {} };
}

async function saveLog(projectRoot: string, log: EditLog): Promise<void> {
  await mkdir(path.join(projectRoot, ".fittingroom"), { recursive: true });
  await writeFile(editLogPath(projectRoot), `${JSON.stringify(log, null, 2)}\n`);
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
