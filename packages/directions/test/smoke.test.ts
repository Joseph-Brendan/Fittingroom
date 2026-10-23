import { describe, expect, it } from "vitest";
import { directionSpecs } from "../src/index";

describe("directions package", () => {
  it("ships four direction specs with Refined in slot 1", () => {
    expect(directionSpecs.map((spec) => spec.slot)).toEqual([1, 2, 3, 4]);
    expect(directionSpecs[0]?.name).toBe("Refined");
  });
});
