import { readFile } from "node:fs/promises";
import {
  JsxAttribute,
  JsxElement,
  JsxSelfClosingElement,
  Project,
  ScriptTarget,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { applyVariantEdit, type EditOperation } from "./edit-engine";
import { fitroomFilePath, writeJsonAtomic } from "./fitroom-store";

export const structureKinds = [
  "nav",
  "hero",
  "headline",
  "value",
  "cta",
  "social-proof",
  "features",
  "pricing",
  "form",
  "table",
  "chart",
  "list",
  "media",
  "faq",
  "footer",
  "other",
] as const;

export type StructureKind = (typeof structureKinds)[number];
export type StructureDensity = "sparse" | "balanced" | "dense";
export type StructurePriority = "hero" | "normal" | "secondary";
export type StructureCollapse = "none" | "tab" | "accordion";

export interface StructureBlock {
  id: string;
  label: string;
  kind: StructureKind;
  order: number;
  visible: boolean;
  priority: StructurePriority;
  group: string | null;
  collapse: StructureCollapse;
}

export interface StructureFile {
  scope: string;
  page: string;
  density: StructureDensity;
  blocks: StructureBlock[];
}

export type StructureAction =
  | { action: "reorder"; id: string; index: number }
  | { action: "hide"; id: string }
  | { action: "promote"; id: string }
  | { action: "group"; firstId: string; secondId: string; containerId?: string }
  | {
      action: "collapse";
      id: string;
      mode: Exclude<StructureCollapse, "none">;
      containerId?: string;
    }
  | { action: "density"; density: StructureDensity };

export interface StructureActionInput {
  action: StructureAction;
  filePath: string;
  page: string;
  projectRoot: string;
  scope: string;
  slug: string;
}

export interface ExtractStructureInput {
  density?: StructureDensity;
  filePath: string;
  page: string;
  scope: string;
}

export interface StructureActionResult {
  source: string;
  structure: StructureFile;
}

type TargetElement = JsxElement | JsxSelfClosingElement;

function newProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: 4,
      target: ScriptTarget.ES2022,
    },
  });
}

function elementAttribute(element: TargetElement, name: string): JsxAttribute | undefined {
  const opening = element instanceof JsxElement ? element.getOpeningElement() : element;

  return opening.getAttribute(name) instanceof JsxAttribute
    ? (opening.getAttribute(name) as JsxAttribute)
    : undefined;
}

function elementId(element: TargetElement): string | null {
  const initializer = elementAttribute(element, "data-fr-id")?.getInitializer();

  if (initializer === undefined) {
    return null;
  }

  const text = initializer.getText();

  return text.startsWith('"') || text.startsWith("'") ? text.slice(1, -1) : null;
}

function tagName(element: TargetElement): string {
  const tag =
    element instanceof JsxElement
      ? element.getOpeningElement().getTagNameNode().getText()
      : element.getTagNameNode().getText();

  return tag.toLowerCase();
}

function childElements(element: JsxElement): TargetElement[] {
  return element
    .getJsxChildren()
    .filter(
      (child): child is TargetElement =>
        child instanceof JsxElement || child instanceof JsxSelfClosingElement,
    );
}

function rootElement(sourceFile: SourceFile): JsxElement | undefined {
  const elements = sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxElement)
    .sort((first, second) => first.getStart() - second.getStart());

  return (
    elements.find((element) => tagName(element as TargetElement) === "main") ??
    elements.find((element) => !["style", "script"].includes(tagName(element as TargetElement)))
  );
}

function labelFor(element: TargetElement): string {
  const aria = elementAttribute(element, "aria-label")?.getInitializer()?.getText();

  if (aria !== undefined) {
    const value = aria.replace(/^["']|["']$/g, "").trim();

    if (value !== "") {
      return value.slice(0, 60);
    }
  }

  const text = element.getText();
  const matches = [...text.matchAll(/>([^<>{}]+)</g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((value) => value !== "");

  return (matches[0] ?? tagName(element)).slice(0, 60);
}

function kindFor(element: TargetElement): StructureKind {
  const tag = tagName(element);

  if (tag === "nav") return "nav";
  if (tag === "footer") return "footer";
  if (tag === "form") return "form";
  if (tag === "table") return "table";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "img" || tag === "picture" || tag === "video") return "media";
  if (tag === "details") return "faq";
  if (tag === "button" || tag === "a") return "cta";
  if (tag === "h1" || tag === "h2" || tag === "h3") return "headline";
  if (tag === "p") return "value";

  if (tag === "header") {
    return "hero";
  }

  if (tag === "section") {
    if (element instanceof JsxElement) {
      const headings = element
        .getDescendantsOfKind(SyntaxKind.JsxElement)
        .map((child) => tagName(child as TargetElement));

      if (headings.includes("h1")) {
        return "hero";
      }

      if (headings.includes("h2") || headings.includes("h3")) {
        return "features";
      }
    }

    return "other";
  }

  if (tag === "main" || tag === "div" || tag === "article" || tag === "aside") {
    return "other";
  }

  return "other";
}

function rootIdFor(element: TargetElement): string | null {
  const parent = element.getParent();

  if (parent instanceof JsxElement) {
    return elementId(parent);
  }

  return null;
}

export async function extractStructure(input: ExtractStructureInput): Promise<StructureFile> {
  const source = await readFile(input.filePath, "utf8");
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", source);
  const root = rootElement(sourceFile);

  if (root === undefined) {
    return {
      scope: input.scope,
      page: input.page,
      density: input.density ?? "balanced",
      blocks: [],
    };
  }

  const blocks = childElements(root).flatMap((element, index) => {
    const id = elementId(element);

    if (id === null) {
      return [];
    }

    const kind = kindFor(element);

    return [
      {
        id,
        label: labelFor(element),
        kind,
        order: index + 1,
        visible: true,
        priority: kind === "hero" ? ("hero" as const) : ("normal" as const),
        group: null,
        collapse: "none" as const,
      },
    ];
  });

  return {
    scope: input.scope,
    page: input.page,
    density: input.density ?? "balanced",
    blocks: blocks.map((block, index) => ({ ...block, order: index + 1 })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBlock(value: unknown): StructureBlock | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value.id;
  const label = value.label;
  const kind = value.kind;
  const order = value.order;

  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof kind !== "string" ||
    !structureKinds.includes(kind as StructureKind) ||
    typeof order !== "number"
  ) {
    return null;
  }

  const priority =
    value.priority === "hero" || value.priority === "secondary" ? value.priority : "normal";
  const collapse =
    value.collapse === "tab" || value.collapse === "accordion" ? value.collapse : "none";

  return {
    id,
    label,
    kind: kind as StructureKind,
    order,
    visible: value.visible !== false,
    priority,
    group: typeof value.group === "string" ? value.group : null,
    collapse,
  };
}

export async function readStructure(projectRoot: string): Promise<StructureFile | null> {
  try {
    const raw = JSON.parse(
      await readFile(fitroomFilePath(projectRoot, "structure.json"), "utf8"),
    ) as unknown;

    if (
      !isRecord(raw) ||
      typeof raw.scope !== "string" ||
      typeof raw.page !== "string" ||
      !Array.isArray(raw.blocks)
    ) {
      return null;
    }

    const density = raw.density === "sparse" || raw.density === "dense" ? raw.density : "balanced";

    return {
      scope: raw.scope,
      page: raw.page,
      density,
      blocks: raw.blocks.flatMap((entry) => {
        const block = parseBlock(entry);

        return block === null ? [] : [block];
      }),
    };
  } catch {
    return null;
  }
}

export async function writeStructure(projectRoot: string, structure: StructureFile): Promise<void> {
  await writeJsonAtomic(fitroomFilePath(projectRoot, "structure.json"), structure);
}

function renumber(blocks: StructureBlock[]): StructureBlock[] {
  return blocks.map((block, index) => ({ ...block, order: index + 1 }));
}

function findBlock(structure: StructureFile, id: string): StructureBlock {
  const block = structure.blocks.find((candidate) => candidate.id === id);

  if (block === undefined) {
    throw new Error(`Block ${id} is not in the current structure.`);
  }

  return block;
}

async function rootIdForFile(filePath: string, id: string): Promise<string> {
  const source = await readFile(filePath, "utf8");
  const project = newProject();
  const sourceFile = project.createSourceFile("variant.tsx", source);
  const elements = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ].sort((first, second) => first.getStart() - second.getStart());
  const element = elements.find((candidate) => elementId(candidate as TargetElement) === id);

  if (element === undefined) {
    throw new Error(`No element has data-fr-id ${id}.`);
  }

  const parentId = rootIdFor(element as TargetElement);

  if (parentId === null) {
    throw new Error(`Block ${id} has no parent with a data-fr-id.`);
  }

  return parentId;
}

async function applyOperations(
  filePath: string,
  operations: EditOperation[],
  input: StructureActionInput,
): Promise<string> {
  for (const operation of operations) {
    await applyVariantEdit(filePath, operation, {
      projectRoot: input.projectRoot,
      slug: input.slug,
    });
  }

  return readFile(filePath, "utf8");
}

export async function applyStructureAction(
  input: StructureActionInput,
): Promise<StructureActionResult> {
  const existing =
    (await readStructure(input.projectRoot)) ??
    (await extractStructure({
      filePath: input.filePath,
      page: input.page,
      scope: input.scope,
    }));
  const structure: StructureFile = {
    ...existing,
    scope: input.scope,
    page: input.page,
    blocks: existing.blocks.map((block) => ({ ...block })),
  };
  const operations: EditOperation[] = [];
  const action = input.action;

  if (action.action === "reorder") {
    const block = findBlock(structure, action.id);
    const parent = await rootIdForFile(input.filePath, action.id);

    operations.push({ op: "move", id: block.id, parent, index: action.index });
    structure.blocks = structure.blocks.filter((candidate) => candidate.id !== action.id);
    structure.blocks.splice(action.index, 0, block);
    structure.blocks = renumber(structure.blocks);
  } else if (action.action === "hide") {
    const block = findBlock(structure, action.id);

    block.visible = false;
    operations.push({ op: "delete", id: block.id });
  } else if (action.action === "promote") {
    const block = findBlock(structure, action.id);
    const parent = await rootIdForFile(input.filePath, action.id);

    operations.push({ op: "move", id: block.id, parent, index: 0 });
    operations.push({
      op: "set-token",
      id: block.id,
      property: "fontSize",
      token: "48px",
    });
    operations.push({
      op: "set-token",
      id: block.id,
      property: "fontWeight",
      token: "700",
    });
    for (const candidate of structure.blocks) {
      candidate.priority = candidate.id === block.id ? "hero" : "normal";
    }

    structure.blocks = structure.blocks.filter((candidate) => candidate.id !== action.id);
    structure.blocks.unshift(block);
    structure.blocks = renumber(structure.blocks);
  } else if (action.action === "group") {
    const first = findBlock(structure, action.firstId);
    const second = findBlock(structure, action.secondId);
    const groupCount = new Set(
      structure.blocks.flatMap((block) => (block.group === null ? [] : [block.group])),
    ).size;
    const containerId = action.containerId ?? `group-${groupCount + 1}`;

    operations.push({
      op: "group",
      firstId: first.id,
      secondId: second.id,
      containerId,
    });
    first.group = containerId;
    second.group = containerId;
  } else if (action.action === "collapse") {
    const block = findBlock(structure, action.id);
    const containerId = action.containerId ?? `collapse-${block.id}`;

    operations.push({
      op: "collapse",
      id: block.id,
      mode: action.mode,
      containerId,
      label: `Show ${block.label}`,
    });
    block.collapse = action.mode;
    block.group = containerId;
  } else {
    const spacing =
      action.density === "sparse" ? "48px" : action.density === "dense" ? "12px" : "24px";

    for (const block of structure.blocks.filter((candidate) => candidate.visible)) {
      operations.push({
        op: "set-token",
        id: block.id,
        property: "padding",
        token: spacing,
      });
    }

    structure.density = action.density;
  }

  const source = await applyOperations(input.filePath, operations, input);
  const next = await extractStructure({
    density: structure.density,
    filePath: input.filePath,
    page: input.page,
    scope: input.scope,
  });

  structure.blocks = structure.blocks.map((block) => {
    const found = next.blocks.find((candidate) => candidate.id === block.id);

    return found === undefined
      ? block
      : {
          ...found,
          collapse: block.collapse,
          group: block.group,
          order: block.order,
          priority: block.priority,
          visible: block.visible,
        };
  });
  await writeStructure(input.projectRoot, structure);

  return { source, structure };
}
