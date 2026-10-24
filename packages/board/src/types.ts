export interface BoardFinding {
  id: string;
  title: string;
  citation: string;
  citationUrl: string;
  severity: number;
  confidence: "measured" | "judged";
  variantSlug: string;
  fix: string;
}

export type BoardStatus =
  | "empty"
  | "generating"
  | "directions_ready"
  | "approved"
  | "handoff_created"
  | "verifying"
  | "verified"
  | "verify_failed";

export interface BoardVariant {
  slug: string;
  name: string;
  rationale: string;
  slot: number;
  pinned: boolean;
  mode?: "light" | "deep";
  role?: "refined" | "native" | "bold" | "wildcard";
  filePath?: string;
  previewPath?: string;
  screenshotPath?: string;
}

export interface BoardSelection {
  slot: number;
  slug: string;
}

export interface BoardApproval {
  slot: number;
  slug: string;
  round: number;
}

export interface BoardRoundSummary {
  id: string;
  createdAt: string;
  variants: Array<{ slot: number; name: string; slug?: string }>;
}

export interface BoardDesignSystem {
  status: "connected" | "partial" | "none";
  summary: string;
  tokens: {
    color: Record<string, string>;
    space: Record<string, string>;
    radius: Record<string, string>;
    font: Record<string, string>;
    fontSize: Record<string, string>;
    shadow: Record<string, string>;
  };
  components: string[];
}

export interface BoardState {
  version?: 2;
  page?: string;
  scope: {
    id: string;
    name: string;
  };
  scopes?: Array<{ id: string; name: string }>;
  designSystem?: BoardDesignSystem;
  surface?: "marketing" | "app" | "dashboard";
  round?: number;
  status?: BoardStatus;
  variants: BoardVariant[];
  findings: BoardFinding[];
  previousRounds: BoardRoundSummary[];
  selected?: BoardSelection | null;
  approved?: BoardApproval | null;
}

export const viewportWidths = [375, 768, 1440] as const;

export type ViewportWidth = (typeof viewportWidths)[number];

export interface BoardRoundSnapshot {
  id: string;
  slot: number;
  role: "refined" | "native" | "bold" | "wildcard";
  slug: string;
  name: string;
  rationale: string;
  file: string;
  orig: string | null;
  editLog: string | null;
  screenshot: string | null;
  current: boolean;
  createdAt: string;
}

export interface BoardRound {
  version: 1;
  id: string;
  number: number;
  createdAt: string;
  scope: { id: string; name: string };
  variants: BoardRoundSnapshot[];
}

export type StructureKind =
  | "nav"
  | "hero"
  | "headline"
  | "value"
  | "cta"
  | "social-proof"
  | "features"
  | "pricing"
  | "form"
  | "table"
  | "chart"
  | "list"
  | "media"
  | "faq"
  | "footer"
  | "other";

export interface StructureBlock {
  id: string;
  label: string;
  kind: StructureKind;
  order: number;
  visible: boolean;
  priority: "hero" | "normal" | "secondary";
  group: string | null;
  collapse: "none" | "tab" | "accordion";
}

export interface StructureFile {
  scope: string;
  page: string;
  density: "sparse" | "balanced" | "dense";
  blocks: StructureBlock[];
}

export type StructureAction =
  | { action: "reorder"; id: string; index: number }
  | { action: "hide"; id: string }
  | { action: "promote"; id: string }
  | { action: "group"; firstId: string; secondId: string }
  | { action: "collapse"; id: string; mode: "tab" | "accordion" }
  | { action: "density"; density: "sparse" | "balanced" | "dense" };
