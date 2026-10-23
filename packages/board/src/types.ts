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

export interface BoardVariant {
  slug: string;
  name: string;
  rationale: string;
  slot: number;
  pinned: boolean;
  mode?: "light" | "deep";
}

export interface BoardRoundSummary {
  id: string;
  createdAt: string;
  variants: Array<{ slot: number; name: string }>;
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
  scope: {
    id: string;
    name: string;
  };
  designSystem?: BoardDesignSystem;
  surface?: "marketing" | "app" | "dashboard";
  variants: BoardVariant[];
  findings: BoardFinding[];
  previousRounds: BoardRoundSummary[];
}

export const viewportWidths = [375, 768, 1440] as const;

export type ViewportWidth = (typeof viewportWidths)[number];
