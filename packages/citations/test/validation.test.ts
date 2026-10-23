import { describe, expect, it } from "vitest";
import {
  approvedSources,
  citationRegistry,
  type Finding,
  validate,
  validateCitationRegistry,
} from "../src/index";

const approvedHosts = ["w3.org", "nngroup.com", "developer.apple.com", "m3.material.io"];

const validFinding: Finding = {
  id: "finding-1",
  title: "Status text has low contrast",
  citation: "wcag22-1.4.3",
  severity: 2,
  confidence: "measured",
  evidence: ".helper has a contrast ratio of 2.32:1.",
  fix: "Use a text color with a contrast ratio of at least 4.5:1.",
};

describe("citation registry entries", () => {
  it("ships entries with the required schema", () => {
    expect(citationRegistry.citations.length).toBeGreaterThan(0);

    for (const citation of citationRegistry.citations) {
      expect(citation.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
      expect(citation.source.length).toBeGreaterThan(0);
      expect(citation.criterion.length).toBeGreaterThan(0);
      expect(citation.title.length).toBeGreaterThan(0);
      expect(citation.version.length).toBeGreaterThan(0);
      expect(["A", "AA", "AAA", "N/A"]).toContain(citation.level);
      expect(approvedSources).toContain(citation.source);

      const url = new URL(citation.url);

      expect(url.protocol).toBe("https:");
      expect(
        approvedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)),
      ).toBe(true);
    }
  });

  it("rejects a citation entry that is missing a level", () => {
    const result = validateCitationRegistry({
      version: 1,
      citations: [
        {
          id: "example-citation",
          source: "WCAG 2.2",
          criterion: "1.1.1",
          title: "Non-text Content",
          url: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
          version: "2.2",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("level");
  });

  it("covers all WCAG 2.2 level A and AA success criteria", () => {
    const wcag = citationRegistry.citations.filter((citation) => citation.source === "WCAG 2.2");

    expect(wcag).toHaveLength(55);
    expect(wcag.every((citation) => citation.level === "A" || citation.level === "AA")).toBe(true);
    expect(wcag.every((citation) => citation.version === "2.2")).toBe(true);
  });

  it("includes Nielsen's ten heuristics and the required guidance sources", () => {
    const ids = new Set(citationRegistry.citations.map((citation) => citation.id));

    for (let index = 1; index <= 10; index += 1) {
      expect(ids.has(`nielsen-h${index}`)).toBe(true);
    }

    for (const id of [
      "nng-severity-scale",
      "apple-hig-hit-targets",
      "material3-touch-targets",
      "apg-dialog",
      "apg-tabs",
      "apg-menu",
      "apg-combobox",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe("finding validation", () => {
  it("rejects a finding whose citation is not in the registry", () => {
    const result = validate({ ...validFinding, citation: "wcag22-9.9.9" });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("wcag22-9.9.9");
  });

  it("rejects a finding with empty evidence", () => {
    const result = validate({ ...validFinding, evidence: "   " });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Evidence");
  });

  it("accepts a finding with a known citation and evidence", () => {
    expect(validate(validFinding)).toEqual({ valid: true, errors: [] });
  });

  it("accepts related citations that are in the registry", () => {
    const result = validate({ ...validFinding, related: ["wcag22-4.1.2"] });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("rejects a related citation that is not in the registry", () => {
    const result = validate({ ...validFinding, related: ["wcag22-9.9.9"] });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("wcag22-9.9.9");
  });

  it("rejects a related citation that repeats the primary citation", () => {
    const result = validate({ ...validFinding, related: ["wcag22-1.4.3"] });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("primary citation");
  });
});
