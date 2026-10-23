import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { directionLibrary } from "../src/index";

interface ContrastPair {
  background: string;
  foreground: string;
  ratio: number;
  usage: string;
}

interface DirectionFile {
  colorRecipe: {
    contrastPairs: ContrastPair[];
  };
  slug: string;
}

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const directionsDirectory = path.join(packageRoot, "directions");
const schemaPath = path.join(packageRoot, "direction.schema.json");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;

    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

async function directionFiles(): Promise<string[]> {
  return (await readdir(directionsDirectory)).filter((file) => file.endsWith(".json")).sort();
}

describe("design direction library", () => {
  it("exports all 36 directions from the package", () => {
    expect(directionLibrary).toHaveLength(36);
    expect(directionLibrary.map((direction) => direction.slug)).toContain("clean-ui");
  });

  it("ships 36 direction files", async () => {
    expect(await directionFiles()).toHaveLength(36);
  });

  it("validates every direction file", async () => {
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema);
    const failures: string[] = [];
    const files = await directionFiles();

    for (const file of files) {
      const direction = JSON.parse(
        await readFile(path.join(directionsDirectory, file), "utf8"),
      ) as DirectionFile;

      if (!validate(direction)) {
        failures.push(`${file}: ${ajv.errorsText(validate.errors)}`);
      }

      if (direction.slug !== path.basename(file, ".json")) {
        failures.push(`${file}: slug does not match the file name`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps every contrast pair above the WCAG AA text minimum", async () => {
    const failures: string[] = [];

    for (const file of await directionFiles()) {
      const direction = JSON.parse(
        await readFile(path.join(directionsDirectory, file), "utf8"),
      ) as DirectionFile;

      for (const pair of direction.colorRecipe.contrastPairs) {
        const measured = contrastRatio(pair.foreground, pair.background);

        if (measured < 4.5) {
          failures.push(`${file}: ${pair.usage} is ${measured.toFixed(2)}:1, below 4.5:1`);
        }

        if (Math.abs(measured - pair.ratio) > 0.01) {
          failures.push(
            `${file}: ${pair.usage} claims ${pair.ratio}:1 but measures ${measured.toFixed(2)}:1`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
