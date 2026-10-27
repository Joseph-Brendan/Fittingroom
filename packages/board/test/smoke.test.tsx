import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import type { BoardState } from "../src/types";

const state: BoardState = {
  scope: { id: "auth", name: "Authentication" },
  variants: [
    {
      slug: "refined",
      name: "Refined",
      rationale: "Keeps the current look.",
      slot: 1,
      pinned: false,
    },
    { slug: "native", name: "Clean UI", rationale: "Uses quiet spacing.", slot: 2, pinned: false },
    {
      slug: "bold",
      name: "Dark-First",
      rationale: "Moves to a dark canvas.",
      slot: 3,
      pinned: false,
    },
    { slug: "wildcard", name: "Spatial", rationale: "Adds calm depth.", slot: 4, pinned: false },
  ],
  previousRounds: [],
  findings: [],
};

const tokens = {
  color: { brand: "#1d4ed8" },
  space: { sm: "8px" },
  radius: { card: "12px" },
  font: { sans: "Inter, system-ui, sans-serif" },
  fontSize: { sm: "14px" },
  shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
};

describe("board package", () => {
  it("renders four comparison cards and the direction form", () => {
    const html = renderToStaticMarkup(<App initialState={state} token="test-token" />);

    expect(html).toContain("Fitroom");
    expect(html.match(/class="variant-card"/g)).toHaveLength(4);
    expect(html).toContain("Try another direction");
    expect(html).toContain("Findings (0)");
  });
});

describe("design system banner", () => {
  it("shows connected, partial and none states", () => {
    const connected = renderToStaticMarkup(
      <App
        initialState={{
          ...state,
          designSystem: {
            status: "connected",
            summary: "Design system connected: Tailwind v4 @theme.",
            tokens,
            components: ["Button"],
          },
        }}
        token="test-token"
      />,
    );
    const partial = renderToStaticMarkup(
      <App
        initialState={{
          ...state,
          designSystem: {
            status: "partial",
            summary: "Design system partly found: CSS variables. Missing shadow.",
            tokens,
            components: [],
          },
        }}
        token="test-token"
      />,
    );
    const none = renderToStaticMarkup(
      <App
        initialState={{
          ...state,
          designSystem: { status: "none", summary: "", tokens, components: [] },
        }}
        token="test-token"
      />,
    );

    expect(connected).toContain("Design system connected:");
    expect(partial).toContain("Design system partly found:");
    expect(none).toContain("Design system not found.");
  });
});

describe("empty board", () => {
  it("shows the page group picker, design system banner and empty state", () => {
    const html = renderToStaticMarkup(
      <App
        initialState={{
          scope: { id: "marketing", name: "Marketing" },
          scopes: [
            { id: "marketing", name: "Marketing" },
            { id: "auth", name: "Authentication" },
          ],
          variants: [],
          findings: [],
          previousRounds: [],
        }}
        token="test-token"
      />,
    );

    expect(html).toContain("Page group");
    expect(html).toContain("Design system not found.");
    expect(html).toContain("No directions yet.");
    expect(html).toContain("Run an audit and generate directions, or click Generate directions.");
    expect(html).toContain("Generate directions");
    expect(html).toContain("Marketing");
    expect(html).toContain("Authentication");
  });
});
