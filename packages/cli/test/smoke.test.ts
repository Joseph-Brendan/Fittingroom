import { describe, expect, it } from "vitest";
import { getHelpText } from "../src/help";

describe("cli package", () => {
  it("shows the fitroom command and its usage", () => {
    const help = getHelpText();

    expect(help).toContain("Usage: fitroom");
    expect(help).toContain("--version");
  });
});
