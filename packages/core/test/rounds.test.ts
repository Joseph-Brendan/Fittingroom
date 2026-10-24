import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emptyBoardState,
  listRounds,
  restoreRoundVariant,
  saveRoundSnapshot,
  writeBoardState,
} from "../src/index";

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-rounds-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

async function writeFileAt(
  projectRoot: string,
  relative: string,
  content: string,
): Promise<string> {
  const filePath = path.join(projectRoot, relative);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);

  return filePath;
}

describe("round history", () => {
  it("saves a variant with its code, original, edit log and screenshot", async () => {
    const projectRoot = path.join(temporaryDirectory, "save");
    const filePath = await writeFileAt(projectRoot, "variants/refined.tsx", "<h1>Round 1</h1>\n");
    const origPath = await writeFileAt(
      projectRoot,
      ".fittingroom/variants/refined.orig.tsx",
      "<h1>Original</h1>\n",
    );
    const editLogPath = await writeFileAt(
      projectRoot,
      ".fittingroom/edits/refined.json",
      '{"version":1}\n',
    );
    const screenshotPath = await writeFileAt(projectRoot, "preview.png", "png");

    const snapshot = await saveRoundSnapshot(projectRoot, {
      number: 1,
      scope: { id: "auth", name: "Authentication" },
      variant: {
        filePath,
        name: "Refined",
        origPath,
        editLogPath,
        rationale: "Keeps the style.",
        role: "refined",
        screenshotPath,
        slug: "refined",
        slot: 1,
      },
    });

    expect(snapshot.current).toBe(true);
    expect(
      await readFile(path.join(projectRoot, ".fittingroom", "rounds", "1", snapshot.file), "utf8"),
    ).toBe("<h1>Round 1</h1>\n");
    expect(snapshot.orig).not.toBeNull();
    expect(snapshot.editLog).not.toBeNull();
    expect(snapshot.screenshot).not.toBeNull();
    expect((await listRounds(projectRoot)).map((round) => round.number)).toEqual([1]);
  });

  it("restores code and edits, then keeps the replaced variant restorable", async () => {
    const projectRoot = path.join(temporaryDirectory, "restore");
    const currentPath = await writeFileAt(
      projectRoot,
      "variants/refined.tsx",
      "<h1>Current</h1>\n",
    );
    const currentOrig = await writeFileAt(
      projectRoot,
      ".fittingroom/variants/refined.orig.tsx",
      "<h1>Current original</h1>\n",
    );
    const currentLog = await writeFileAt(
      projectRoot,
      ".fittingroom/edits/refined.json",
      '{"version":1,"edits":["current"]}\n',
    );

    await writeBoardState(projectRoot, {
      ...emptyBoardState({ id: "auth", name: "Authentication" }),
      round: 3,
      status: "directions_ready",
      variants: [
        {
          slug: "refined",
          name: "Refined",
          rationale: "Current round.",
          slot: 1,
          pinned: false,
          role: "refined",
          filePath: "variants/refined.tsx",
        },
      ],
    });

    const oldPath = await writeFileAt(projectRoot, "old/refined.tsx", "<h1>Round 1</h1>\n");
    const oldOrig = await writeFileAt(
      projectRoot,
      "old/refined.orig.tsx",
      "<h1>Old original</h1>\n",
    );
    const oldLog = await writeFileAt(
      projectRoot,
      "old/refined.json",
      '{"version":1,"edits":["old"]}\n',
    );
    const old = await saveRoundSnapshot(projectRoot, {
      number: 1,
      scope: { id: "auth", name: "Authentication" },
      variant: {
        editLogPath: oldLog,
        filePath: oldPath,
        name: "Refined",
        origPath: oldOrig,
        rationale: "Round 1.",
        role: "refined",
        slug: "refined",
        slot: 1,
      },
    });

    await saveRoundSnapshot(projectRoot, {
      number: 3,
      scope: { id: "auth", name: "Authentication" },
      variant: {
        editLogPath: currentLog,
        filePath: currentPath,
        name: "Refined",
        origPath: currentOrig,
        rationale: "Current round.",
        role: "refined",
        slug: "refined",
        slot: 1,
      },
    });

    const restored = await restoreRoundVariant(projectRoot, {
      round: 1,
      scope: { id: "auth", name: "Authentication" },
      snapshotId: old.id,
    });

    expect(await readFile(currentPath, "utf8")).toBe("<h1>Round 1</h1>\n");
    expect(await readFile(currentOrig, "utf8")).toBe("<h1>Old original</h1>\n");
    expect(await readFile(currentLog, "utf8")).toBe('{"version":1,"edits":["old"]}\n');
    expect(restored.state.variants[0]?.rationale).toBe("Round 1.");

    const currentRound = (await listRounds(projectRoot)).find((round) => round.number === 3);

    expect(currentRound?.variants.some((snapshot) => snapshot.current === true)).toBe(true);

    const replaced = currentRound?.variants.find(
      (snapshot) => snapshot.current === false && snapshot.rationale === "Current round.",
    );

    expect(replaced).toBeDefined();

    if (replaced === undefined) {
      throw new Error("The replaced variant was not saved.");
    }

    await restoreRoundVariant(projectRoot, {
      round: 3,
      scope: { id: "auth", name: "Authentication" },
      snapshotId: replaced.id,
    });

    expect(await readFile(currentPath, "utf8")).toBe("<h1>Current</h1>\n");
    expect(await readFile(currentLog, "utf8")).toBe('{"version":1,"edits":["current"]}\n');
  });
});
