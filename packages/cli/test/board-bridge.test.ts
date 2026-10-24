import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startBoardServer } from "../src/board-server";

const temporaryDirectories: string[] = [];

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-board-bridge-"));
  temporaryDirectories.push(directory);

  return directory;
}

async function writeState(projectRoot: string, approved: boolean): Promise<void> {
  const fittingRoom = path.join(projectRoot, ".fittingroom");

  await mkdir(fittingRoom, { recursive: true });
  await writeFile(
    path.join(fittingRoom, "board.json"),
    `${JSON.stringify(
      {
        version: 2,
        scope: { id: "marketing", name: "Marketing" },
        round: 1,
        status: approved ? "approved" : "directions_ready",
        variants: [
          {
            slug: "refined",
            name: "Refined",
            rationale: "Keeps the current style.",
            slot: 1,
            pinned: false,
          },
        ],
        findings: [],
        previousRounds: [],
        selected: approved ? { slot: 1, slug: "refined" } : null,
        approved: approved ? { slot: 1, slug: "refined", round: 1 } : null,
      },
      null,
      2,
    )}\n`,
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("board bridge server", () => {
  it("writes a lock and accepts a generate request", async () => {
    const projectRoot = await temporaryProject();

    await writeState(projectRoot, false);

    const server = await startBoardServer({ port: 0, projectRoot });

    try {
      const lock = JSON.parse(
        await readFile(path.join(projectRoot, ".fittingroom", "board.lock"), "utf8"),
      ) as { pid: number; port: number; token: string };

      expect(lock.pid).toBe(process.pid);
      expect(lock.port).toBe(server.port);
      expect(lock.token).toBe(server.token);

      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/request?token=${server.token}`,
        {
          body: JSON.stringify({ type: "generate" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      expect(response.ok).toBe(true);

      const requests = JSON.parse(
        await readFile(path.join(projectRoot, ".fittingroom", "requests.json"), "utf8"),
      ) as { requests: Array<{ type: string; completedAt?: string }> };

      expect(requests.requests).toHaveLength(1);
      expect(requests.requests[0]).toMatchObject({ type: "generate" });

      const state = (await (
        await fetch(`http://127.0.0.1:${server.port}/api/board?token=${server.token}`)
      ).json()) as { status: string };

      expect(state.status).toBe("generating");
    } finally {
      await server.close();
    }

    await expect(
      readFile(path.join(projectRoot, ".fittingroom", "board.lock"), "utf8"),
    ).rejects.toThrow();
  });

  it("restores the approved board state after a restart", async () => {
    const projectRoot = await temporaryProject();

    await writeState(projectRoot, false);

    const first = await startBoardServer({ port: 0, projectRoot });

    await first.close();
    await writeState(projectRoot, true);

    const second = await startBoardServer({ port: 0, projectRoot });

    try {
      const state = (await (
        await fetch(`http://127.0.0.1:${second.port}/api/board?token=${second.token}`)
      ).json()) as { approved: unknown; status: string };

      expect(state.status).toBe("approved");
      expect(state.approved).toEqual({ slot: 1, slug: "refined", round: 1 });
    } finally {
      await second.close();
    }
  });
});
