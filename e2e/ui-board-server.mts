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

const waiting = process.env.BOARD_UI_WAITING === "1";
const empty = process.env.BOARD_UI_EMPTY === "1" || waiting;
const port = Number(process.env.BOARD_UI_PORT ?? "4180");
const sessionPath = path.resolve(
  process.env.BOARD_UI_APPROVED === "1"
    ? "e2e/.ui-board-approved-session.json"
    : process.env.BOARD_UI_WAITING === "1"
      ? "e2e/.ui-board-waiting-session.json"
      : empty
        ? "e2e/.ui-board-empty-session.json"
        : "e2e/.ui-board-session.json",
);

interface PreviewNode {
  children?: PreviewNode[];
  id: string;
  style?: Record<string, string>;
  tag: string;
  text?: string;
}

const variants = [
  {
    slug: "refined",
    name: "Refined",
    rationale:
      "Keeps the current layout, brand colors and type while fixing the contrast failure and tightening the helper text under the form.",
    slot: 1,
    pinned: false,
  },
  {
    slug: "native",
    name: "Clean UI",
    rationale: "Uses quiet spacing and one clear primary action with a calm neutral surface.",
    slot: 2,
    pinned: true,
  },
  {
    slug: "bold",
    name: "Dark-First",
    rationale: "Moves the interface to a dark canvas with a strong focus color and crisp borders.",
    slot: 3,
    pinned: false,
  },
  {
    slug: "wildcard",
    name: "Spatial",
    rationale: "Layers the content into calm panels with depth and a generous content rhythm.",
    slot: 4,
    pinned: false,
  },
];

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

  if (style !== "") attributes.push(`style="${escapeHtml(style)}"`);

  return `<${node.tag} ${attributes.join(" ")}>${escapeHtml(node.text ?? "")}${(node.children ?? []).map(renderNode).join("")}</${node.tag}>`;
}

function variantTree(name: string): PreviewNode {
  return {
    id: "main",
    tag: "main",
    style: { padding: "32px", fontFamily: "system-ui, sans-serif" },
    children: [
      { id: "page-title", tag: "h1", text: `${name} preview` },
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
      { id: "footer-copy", tag: "p", text: "Built for small product teams." },
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

function insertNode(component: string, id: string, text: string): PreviewNode {
  const name = component.toLowerCase();
  if (name === "button") return { id, tag: "button", text: text || "Continue" };
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
      node.style = { ...(node.style ?? {}), [String(operation.property)]: String(operation.token) };
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
        if (node !== undefined) children.splice(Number(operation.index), 0, node);
      }
    }
  }

  return previewDocument(slug);
}

const state: BoardState = {
  version: 2,
  scope: { id: "auth", name: "Authentication" },
  scopes: [
    { id: "marketing", name: "Marketing" },
    { id: "auth", name: "Authentication" },
    { id: "dashboard", name: "Dashboard" },
  ],
  surface: "app",
  designSystem,
  round: 2,
  status: process.env.BOARD_UI_APPROVED === "1" ? "approved" : "directions_ready",
  variants,
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
  previousRounds: [
    {
      id: "round-1",
      createdAt: new Date().toISOString(),
      variants: [{ slot: 1, name: "Refined" }],
    },
  ],
  selected: process.env.BOARD_UI_APPROVED === "1" ? { slot: 1, slug: "refined" } : null,
  approved: process.env.BOARD_UI_APPROVED === "1" ? { slot: 1, slug: "refined", round: 2 } : null,
};

if (empty) {
  state.scope = { id: "marketing", name: "Marketing" };
  state.scopes = [
    { id: "marketing", name: "Marketing" },
    { id: "auth", name: "Authentication" },
    { id: "dashboard", name: "Dashboard" },
  ];
  state.round = 0;
  state.status = waiting ? "generating" : "empty";
  state.variants = [];
  state.findings = [];
  state.previousRounds = [];
  delete state.designSystem;
  state.selected = null;
  state.approved = null;
}

const rounds = [
  {
    version: 1 as const,
    id: "1",
    number: 1,
    createdAt: new Date().toISOString(),
    scope: { id: "auth", name: "Authentication" },
    variants: variants.map((variant) => ({
      id: `round-1-${variant.slot}`,
      slot: variant.slot,
      role:
        variant.slot === 1
          ? ("refined" as const)
          : variant.slot === 2
            ? ("native" as const)
            : variant.slot === 3
              ? ("bold" as const)
              : ("wildcard" as const),
      slug: variant.slug,
      name: variant.name,
      rationale: variant.rationale,
      file: `${variant.slug}.tsx`,
      orig: null,
      editLog: null,
      screenshot: null,
      current: false,
      createdAt: new Date().toISOString(),
    })),
  },
  {
    version: 1 as const,
    id: "2",
    number: 2,
    createdAt: new Date().toISOString(),
    scope: { id: "auth", name: "Authentication" },
    variants: variants.map((variant) => ({
      id: `round-2-${variant.slot}`,
      slot: variant.slot,
      role:
        variant.slot === 1
          ? ("refined" as const)
          : variant.slot === 2
            ? ("native" as const)
            : variant.slot === 3
              ? ("bold" as const)
              : ("wildcard" as const),
      slug: variant.slug,
      name: variant.name,
      rationale: variant.rationale,
      file: `${variant.slug}.tsx`,
      orig: null,
      editLog: null,
      screenshot: null,
      current: true,
      createdAt: new Date().toISOString(),
    })),
  },
];

const structure = {
  scope: "auth",
  page: "/login",
  density: "balanced" as const,
  blocks: [
    {
      id: "hero",
      label: "Sign in form",
      kind: "form" as const,
      order: 1,
      visible: true,
      priority: "hero" as const,
      group: null,
      collapse: "none" as const,
    },
    {
      id: "body",
      label: "Helper text",
      kind: "value" as const,
      order: 2,
      visible: true,
      priority: "normal" as const,
      group: null,
      collapse: "none" as const,
    },
    {
      id: "footer-copy",
      label: "Footer",
      kind: "footer" as const,
      order: 3,
      visible: true,
      priority: "secondary" as const,
      group: null,
      collapse: "none" as const,
    },
  ],
};

async function main(): Promise<void> {
  await rm(sessionPath, { force: true });

  let revision = 0;
  const regenerate = ({ state: current, slots }: BoardRegenerateInput) => {
    revision += 1;
    const targets = new Set(
      slots ?? current.variants.filter((variant) => !variant.pinned).map((variant) => variant.slot),
    );
    const previousRound = {
      id: `round-${Date.now()}`,
      createdAt: new Date().toISOString(),
      variants: current.variants.map((variant) => ({ slot: variant.slot, name: variant.name })),
    };
    return {
      ...current,
      variants: current.variants.map((variant) => {
        if (!targets.has(variant.slot) || variant.pinned) return variant;
        const baseName = variant.name.replace(/ \d+$/, "");
        return {
          ...variant,
          name: `${baseName} ${revision}`,
          rationale: `Regenerated direction round ${revision}.`,
        };
      }),
      previousRounds: [...current.previousRounds, previousRound],
    };
  };
  const pin = ({ state: current, slot, pinned }: BoardPinInput) => ({
    ...current,
    variants: current.variants.map((variant) =>
      variant.slot === slot ? { ...variant, pinned } : variant,
    ),
  });
  const edit = ({ state: current, slug, operation }: BoardEditInput) => ({
    state: current,
    previewHtml: applyPreviewOperation(slug, operation),
  });
  const undo = ({ state: current, slug }: BoardUndoInput) => {
    const previous = undoStacks[slug]?.pop();
    if (previous !== undefined) trees[slug] = previous;
    return { state: current, previewHtml: previewDocument(slug) };
  };

  const server = await startBoardServer({
    edit,
    pin,
    port,
    previews,
    regenerate,
    ...(empty ? {} : { rounds: () => rounds, structure: () => structure }),
    state,
    undo,
  });

  await writeFile(
    sessionPath,
    `${JSON.stringify({ token: server.token, url: server.url }, null, 2)}\n`,
  );
  process.stdout.write(`UI board ready at ${server.url}\n`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
