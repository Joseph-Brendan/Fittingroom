import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectDesignSystem, type TokenCategory } from "../src/index";
import { fixturePath } from "./helpers/fixture-server";

const tokenCategories: TokenCategory[] = ["color", "space", "radius", "font", "fontSize", "shadow"];

interface DetectionCase {
  fixture: string;
  status: "connected" | "partial" | "none";
  sources: string[];
  components: string[];
  tokens: Partial<Record<TokenCategory, Record<string, string>>>;
  missing: TokenCategory[];
  writesTokens: boolean;
}

const cases: DetectionCase[] = [
  {
    fixture: "tailwind-v4",
    status: "connected",
    sources: ["tailwind-v4"],
    components: [],
    tokens: {
      color: { brand: "#1d4ed8", text: "#111827" },
      space: { sm: "8px", lg: "24px" },
      radius: { card: "12px" },
      font: { sans: "Inter, system-ui, sans-serif" },
      fontSize: { sm: "14px", lg: "20px" },
      shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
    },
    missing: [],
    writesTokens: false,
  },
  {
    fixture: "tailwind-v3",
    status: "connected",
    sources: ["tailwind-v3"],
    components: [],
    tokens: {
      color: { brand: "#1d4ed8", ink: "#111827" },
      space: { sm: "8px", lg: "24px" },
      radius: { card: "12px" },
      font: { sans: "Inter, system-ui, sans-serif" },
      fontSize: { sm: "14px", lg: "20px" },
      shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
    },
    missing: [],
    writesTokens: false,
  },
  {
    fixture: "dtcg",
    status: "connected",
    sources: ["dtcg"],
    components: [],
    tokens: {
      color: { brand: "#1d4ed8", text: "#111827" },
      space: { sm: "8px", lg: "24px" },
      radius: { card: "12px" },
      font: { sans: "Inter, system-ui, sans-serif" },
      fontSize: { sm: "14px", lg: "20px" },
      shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
    },
    missing: [],
    writesTokens: false,
  },
  {
    fixture: "css-variables",
    status: "connected",
    sources: ["css-variables"],
    components: [],
    tokens: {
      color: { brand: "#1d4ed8", text: "#111827" },
      space: { sm: "8px", lg: "24px" },
      radius: { card: "12px" },
      font: { sans: "Inter, system-ui, sans-serif" },
      fontSize: { sm: "14px", lg: "20px" },
      shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
    },
    missing: [],
    writesTokens: false,
  },
  {
    fixture: "shadcn",
    status: "connected",
    sources: ["shadcn", "css-variables"],
    components: ["button"],
    tokens: {
      color: {
        background: "#ffffff",
        foreground: "#111827",
        primary: "#1d4ed8",
        brand: "#1d4ed8",
      },
      space: { sm: "8px" },
      radius: { default: "8px", card: "12px" },
      font: { sans: "Inter, system-ui, sans-serif" },
      fontSize: { sm: "14px" },
      shadow: { card: "0 8px 24px rgba(17, 24, 39, 0.12)" },
    },
    missing: [],
    writesTokens: false,
  },
  {
    fixture: "mui",
    status: "partial",
    sources: ["mui"],
    components: ["MUI"],
    tokens: {},
    missing: tokenCategories,
    writesTokens: true,
  },
  {
    fixture: "none",
    status: "none",
    sources: [],
    components: [],
    tokens: {},
    missing: tokenCategories,
    writesTokens: true,
  },
];

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-design-system-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe.each(cases)("detectDesignSystem: $fixture", (testCase) => {
  it(`detects ${testCase.status} from the ${testCase.fixture} fixture`, async () => {
    const projectRoot = path.join(temporaryDirectory, testCase.fixture);

    await cp(fixturePath(`design-systems/${testCase.fixture}`), projectRoot, {
      recursive: true,
    });

    const result = await detectDesignSystem(projectRoot);

    expect(result.status).toBe(testCase.status);
    expect(result.sources).toEqual(expect.arrayContaining(testCase.sources));
    expect(result.components).toEqual(expect.arrayContaining(testCase.components));
    expect(result.missing).toEqual(testCase.missing);
    expect(Object.keys(result.tokens).sort()).toEqual([...tokenCategories].sort());

    for (const [category, expectedTokens] of Object.entries(testCase.tokens)) {
      expect(result.tokens[category as TokenCategory]).toEqual(expectedTokens);
    }

    const tokensPath = path.join(projectRoot, ".fittingroom", "tokens.json");

    if (testCase.writesTokens) {
      const raw = JSON.parse(await readFile(tokensPath, "utf8")) as {
        missing: TokenCategory[];
        status: string;
        tokens: Record<TokenCategory, Record<string, string>>;
      };

      expect(raw.status).toBe(testCase.status);
      expect(raw.missing).toEqual(testCase.missing);
      expect(Object.keys(raw.tokens).sort()).toEqual([...tokenCategories].sort());
    } else {
      await expect(access(tokensPath)).rejects.toThrow();
    }
  });
});
