import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { coreModules, corePackage } from "../src/index";

describe("core package", () => {
  it("identifies itself and its four modules", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };

    expect(corePackage.name).toBe("@fitroom/core");
    expect(corePackage.version).toBe(manifest.version);
    expect(coreModules).toEqual(["capture", "audit", "detection", "diff"]);
  });
});
