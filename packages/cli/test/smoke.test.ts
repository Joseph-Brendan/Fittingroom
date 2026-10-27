import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getHelpText } from "../src/help";

describe("cli package", () => {
  it("shows the fitroom command and its usage", () => {
    const help = getHelpText();

    expect(help).toContain("Usage: fitroom");
    expect(help).toContain("--version");
  });

  it("shows MCP install commands from the package name", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { name?: unknown };

    if (typeof manifest.name !== "string") {
      throw new Error("packages/cli/package.json needs a name.");
    }

    const help = getHelpText("mcp");

    expect(help).toContain(`npx -y ${manifest.name} mcp`);
    expect(help).toContain(`claude mcp add fitroom -- npx -y ${manifest.name} mcp`);
  });
});
