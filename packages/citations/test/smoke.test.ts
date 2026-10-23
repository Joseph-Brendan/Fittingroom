import { describe, expect, it } from "vitest";
import { citationRegistry, validateCitationRegistry } from "../src/index";

describe("citations package", () => {
  it("ships a citation registry that passes validation", () => {
    const result = validateCitationRegistry(citationRegistry);

    expect(result).toEqual({ valid: true, errors: [] });
    expect(citationRegistry.citations.length).toBeGreaterThan(0);
  });
});
