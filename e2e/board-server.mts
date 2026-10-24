import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type BoardEditInput,
  type BoardPinInput,
  type BoardRegenerateInput,
  type BoardState,
  type BoardUndoInput,
  startBoardServer,
} from "../packages/cli/src/board-server";

const variants = [
  {
    slug: "refined",
    name: "Refined",
    rationale: "Keeps the layout and fixes the contrast failure in the helper text.",
    slot: 1,
    pinned: false,
  },
  {
    slug: "native",
    name: "Clean UI",
    rationale: "Uses quiet spacing and one clear primary action.",
    slot: 2,
    pinned: false,
  },
  {
    slug: "bold",
    name: "Dark-First",
    rationale: "Moves the interface to a dark canvas with a strong focus color.",
    slot: 3,
    pinned: false,
  },
  {
    slug: "wildcard",
    name: "Spatial",
    rationale: "Layers the content into calm panels with depth.",
    slot: 4,
    pinned: false,
  },
];

interface PreviewNode {
  children?: PreviewNode[];
  id: string;
  style?: Record<string, string>;
  tag: string;
  text?: string;
}

const designSystem = {
  status: "connected" as const,
  summary: "Design system connected: Tailwind v4 @theme, shadcn/ui.",
  tokens: {
    color: { brand: "#1d4ed8", text: "#111827" },
    space: { sm: "8px", md: "16px" },
    radius: { card: "12px" },
    font: { sans: "Inter, system-ui, sans-serif" },
    fontSize: { sm: "14px", md: "18px" },
    shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
  },
  components: ["Button"],
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cssProperty(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function renderNode(node: PreviewNode): string {
  const style = Object.entries(node.style ?? {})
    .map(([name, value]) => `${cssProperty(name)}: ${value};`)
    .join(" ");
  const attributes = [`data-fr-id="${escapeHtml(node.id)}"`];

  if (style !== "") {
    attributes.push(`style="${escapeHtml(style)}"`);
  }

  const children = (node.children ?? []).map(renderNode).join("");
  const content = `${escapeHtml(node.text ?? "")}${children}`;

  return `<${node.tag} ${attributes.join(" ")}>${content}</${node.tag}>`;
}

function variantTree(name: string): PreviewNode {
  return {
    id: "main",
    tag: "main",
    children: [
      {
        id: "page-title",
        tag: "h1",
        text: `${name} preview`,
      },
      {
        id: "hero",
        tag: "section",
        children: [
          { id: "hero-title", tag: "h2", text: "A calmer start" },
          { id: "body", tag: "p", text: "Keep the important parts close." },
        ],
      },
      {
        id: "features",
        tag: "section",
        children: [
          { id: "feature-a", tag: "div", text: "Feature A" },
          { id: "feature-b", tag: "div", text: "Feature B" },
        ],
      },
    ],
  };
}

const trees: Record<string, PreviewNode> = Object.fromEntries(
  variants.map((variant) => [variant.slug, variantTree(variant.name)]),
);
const undoStacks: Record<string, PreviewNode[]> = Object.fromEntries(
  variants.map((variant) => [variant.slug, []]),
);

function previewDocument(slug: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><style>
    body { margin: 0; padding: 32px; font-family: system-ui, sans-serif; background: #f8fafc; color: #16181d; }
    h1 { margin: 0 0 20px; font-size: 32px; }
    section { margin: 20px 0; padding: 16px; border: 1px solid #cbd5e1; border-radius: 12px; background: #ffffff; }
    h2 { margin: 0 0 8px; font-size: 20px; }
    p { color: #475569; }
    div { margin-top: 8px; }
  </style></head><body>${renderNode(trees[slug] ?? variantTree(slug))}</body></html>`;
}

const previews: Record<string, string> = Object.fromEntries(
  variants.map((variant) => [variant.slug, previewDocument(variant.slug)]),
);

function findNode(node: PreviewNode, id: string): PreviewNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findParent(node: PreviewNode, id: string): PreviewNode | undefined {
  if ((node.children ?? []).some((child) => child.id === id)) return node;
  for (const child of node.children ?? []) {
    const found = findParent(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function tokenValue(property: string, token: string): string {
  const categories: Record<string, keyof typeof designSystem.tokens> = {
    color: "color",
    padding: "space",
    borderRadius: "radius",
    fontFamily: "font",
    fontSize: "fontSize",
    boxShadow: "shadow",
  };
  const category = categories[property];
  const prefix = token.startsWith(`${category}.`) ? `${category}.` : "";
  const name = prefix === "" ? token : token.slice(prefix.length);
  const tokenTable = designSystem.tokens as Record<string, Record<string, string>>;
  return category === undefined ? token : (tokenTable[category]?.[name] ?? token);
}

function insertNode(component: string, id: string, text: string): PreviewNode {
  const name = component.toLowerCase();

  if (name === "button") {
    return { id, tag: "button", text: text || "Continue" };
  }

  if (name === "heading") return { id, tag: "h2", text: text || "Heading" };
  if (name === "text") return { id, tag: "p", text: text || "Text" };
  if (name === "input") return { id, tag: "input", text: "" };
  return { id, tag: "img", text: "" };
}

function applyPreviewOperation(slug: string, operation: Record<string, unknown>): string {
  const tree = trees[slug];
  if (tree === undefined) throw new Error(`Unknown variant ${slug}.`);
  undoStacks[slug]?.push(structuredClone(tree));
  const op = String(operation.op);
  const id = String(operation.id ?? "");

  if (op === "set-token") {
    const node = findNode(tree, id);
    if (node !== undefined) {
      node.style = {
        ...(node.style ?? {}),
        [String(operation.property)]: tokenValue(
          String(operation.property),
          String(operation.token),
        ),
      };
    }
  } else if (op === "set-text") {
    const node = findNode(tree, id);
    if (node !== undefined) node.text = String(operation.text ?? "");
  } else if (op === "delete") {
    const parent = findParent(tree, id);
    if (parent !== undefined) {
      parent.children = (parent.children ?? []).filter((child) => child.id !== id);
    }
  } else if (op === "duplicate") {
    const parent = findParent(tree, id);
    const node = findNode(tree, id);
    if (parent !== undefined && node !== undefined) {
      const index = (parent.children ?? []).findIndex((child) => child.id === id);
      parent.children?.splice(
        index + 1,
        0,
        structuredClone({ ...node, id: String(operation.newId) }),
      );
    }
  } else if (op === "insert") {
    const parent = findNode(tree, String(operation.parent ?? ""));
    if (parent !== undefined) {
      parent.children = parent.children ?? [];
      parent.children.splice(
        Number(operation.index ?? parent.children.length),
        0,
        insertNode(String(operation.component), String(operation.id), String(operation.text ?? "")),
      );
    }
  } else if (op === "move") {
    const parent = findNode(tree, String(operation.parent ?? ""));
    if (parent !== undefined) {
      const children = parent.children ?? [];
      const index = children.findIndex((child) => child.id === id);
      if (index >= 0) {
        const [node] = children.splice(index, 1);
        if (node !== undefined) {
          children.splice(Number(operation.index), 0, node);
        }
      }
    }
  } else if (op === "swap-section") {
    const first = String(operation.firstId);
    const second = String(operation.secondId);
    const parent = findParent(tree, first);
    if (parent !== undefined) {
      const children = parent.children ?? [];
      const firstIndex = children.findIndex((child) => child.id === first);
      const secondIndex = children.findIndex((child) => child.id === second);
      if (firstIndex >= 0 && secondIndex >= 0) {
        const firstChild = children[firstIndex];
        const secondChild = children[secondIndex];

        if (firstChild !== undefined && secondChild !== undefined) {
          children[firstIndex] = secondChild;
          children[secondIndex] = firstChild;
        }
      }
    }
  }

  return previewDocument(slug);
}

const state: BoardState = {
  version: 2,
  scope: { id: "auth", name: "Authentication" },
  surface: "app",
  designSystem,
  round: 1,
  status: "directions_ready",
  variants,
  previousRounds: [],
  selected: null,
  approved: null,
  findings: [
    {
      id: "F-1",
      title: "Helper text fails contrast",
      citation: "wcag22-1.4.3",
      citationUrl: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
      severity: 3,
      confidence: "measured",
      variantSlug: "refined",
      fix: "Use a darker helper color.",
    },
    {
      id: "F-2",
      title: "Focus ring is hidden by the banner",
      citation: "wcag22-2.4.11",
      citationUrl: "https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html",
      severity: 4,
      confidence: "measured",
      variantSlug: "bold",
      fix: "Move the focused control out from under the banner.",
    },
    {
      id: "F-3",
      title: "Close button is too small",
      citation: "wcag22-2.5.8",
      citationUrl: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html",
      severity: 2,
      confidence: "measured",
      variantSlug: "bold",
      fix: "Make the button at least 24 by 24 CSS pixels.",
    },
  ],
};

async function main(): Promise<void> {
  const sessionPath = path.resolve("e2e", ".board-session.json");

  await rm(sessionPath, { force: true });

  let revision = 0;

  const regenerate = ({ state: current, slots, mode }: BoardRegenerateInput) => {
    revision += 1;
    const targets = new Set(
      slots ?? current.variants.filter((variant) => !variant.pinned).map((variant) => variant.slot),
    );
    const previousRound = {
      id: `round-${revision}`,
      createdAt: new Date().toISOString(),
      variants: current.variants.map((variant) => ({
        slot: variant.slot,
        name: variant.name,
      })),
    };
    const nextVariants = current.variants.map((variant) => {
      if (!targets.has(variant.slot) || variant.pinned) {
        return variant;
      }

      const baseName = variant.name.replace(/ \d+$/, "");

      return {
        ...variant,
        name: `${baseName} ${revision}`,
        rationale: `Regenerated direction round ${revision}.`,
        ...(variant.slot === 1 ? { mode } : {}),
      };
    });

    return {
      ...current,
      variants: nextVariants,
      previousRounds: [...current.previousRounds, previousRound],
    };
  };
  const pin = ({ state: current, slot, pinned }: BoardPinInput) => ({
    ...current,
    variants: current.variants.map((variant) =>
      variant.slot === slot ? { ...variant, pinned } : variant,
    ),
  });

  const edit = ({ state: current, slug, operation }: BoardEditInput) => {
    const previewHtml = applyPreviewOperation(slug, operation);
    return { state: current, previewHtml };
  };
  const undo = ({ state: current, slug }: BoardUndoInput) => {
    const previous = undoStacks[slug]?.pop();
    if (previous !== undefined) {
      trees[slug] = previous;
    }
    return { state: current, previewHtml: previewDocument(slug) };
  };

  const { url, token, close } = await startBoardServer({
    port: 4173,
    previews,
    state,
    regenerate,
    pin,
    edit,
    undo,
  });

  await writeFile(sessionPath, `${JSON.stringify({ token, url }, null, 2)}\n`);

  const shutdown = async () => {
    await close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stdout.write(`Fitting Room board ready at ${url}\n`);
}

void main();
