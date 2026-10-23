import { describe, expect, it } from "vitest";
import { coreModules, corePackage } from "../src/index";

describe("core package", () => {
  it("identifies itself and its four modules", () => {
    expect(corePackage.name).toBe("@fittingroom/core");
    expect(corePackage.version).toBe("0.0.0");
    expect(coreModules).toEqual(["capture", "audit", "detection", "diff"]);
  });
});
