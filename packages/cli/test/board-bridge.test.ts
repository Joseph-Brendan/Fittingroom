import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
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

async function holdPort(port: number): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(null);
        return;
      }

      reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (server === null) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
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

  it("starts on another port when 4173 is busy", async () => {
    const projectRoot = await temporaryProject();

    await writeState(projectRoot, false);

    const blocker = await holdPort(4173);
    const server = await startBoardServer({ projectRoot });

    try {
      expect(server.port).not.toBe(4173);
      expect(server.url).toContain(`127.0.0.1:${server.port}`);
    } finally {
      await server.close();
      await closeServer(blocker);
    }
  });

  it("tries every default port before using any free port", async () => {
    const projectRoot = await temporaryProject();
    const defaultPorts = [4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181, 4182, 4183];

    await writeState(projectRoot, false);

    const blockers = await Promise.all(defaultPorts.map(holdPort));
    const server = await startBoardServer({ projectRoot });

    try {
      expect(defaultPorts).not.toContain(server.port);
      expect(server.url).toContain(`127.0.0.1:${server.port}`);
    } finally {
      await server.close();
      await Promise.all(blockers.map(closeServer));
    }
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
