import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendBoardRequest,
  completeBoardRequest,
  emptyBoardState,
  readBoardRequests,
  readBoardState,
  readLiveBoardLock,
  waitForBoardEvent,
  writeBoardLock,
  writeBoardState,
} from "../src/board-state";

const temporaryDirectories: string[] = [];

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-bridge-"));
  temporaryDirectories.push(directory);

  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("board bridge", () => {
  it("creates a board state with the product defaults", async () => {
    const projectRoot = await temporaryProject();
    const state = await readBoardState(projectRoot);

    expect(state.status).toBe("empty");
    expect(state.round).toBe(0);
    expect(state.variants).toEqual([]);
    expect(state.approved).toBeNull();
    expect(state.selected).toBeNull();
  });

  it("appends a generate request and waits for it", async () => {
    const projectRoot = await temporaryProject();

    await writeBoardState(projectRoot, {
      ...emptyBoardState(),
      scope: { id: "marketing", name: "Marketing" },
    });
    const waiting = waitForBoardEvent(projectRoot, 2_000);
    const request = await appendBoardRequest(projectRoot, { type: "generate" });
    const event = await waiting;

    if (event.timedOut) {
      throw new Error("The board wait timed out.");
    }

    expect(event.request).toMatchObject({ id: request.id, type: "generate", slot: null });
    expect(event.request?.completedAt).toBeUndefined();
  });

  it("completes a request and leaves no open requests", async () => {
    const projectRoot = await temporaryProject();
    const request = await appendBoardRequest(projectRoot, { type: "regenerate-slot", slot: 2 });

    await completeBoardRequest(projectRoot, request.id);

    const file = await readBoardRequests(projectRoot);
    expect(file.requests).toHaveLength(1);
    expect(file.requests[0]?.completedAt).toEqual(expect.any(String));
  });

  it("returns an approval event", async () => {
    const projectRoot = await temporaryProject();

    await writeBoardState(projectRoot, {
      ...emptyBoardState(),
      scope: { id: "marketing", name: "Marketing" },
      round: 1,
      status: "approved",
      approved: { slot: 2, slug: "swiss-international", round: 1 },
    });

    const event = await waitForBoardEvent(projectRoot, 500);

    if (event.timedOut) {
      throw new Error("The board wait timed out.");
    }

    expect(event.approval).toEqual({ slot: 2, slug: "swiss-international", round: 1 });
  });

  it("times out without a request or approval", async () => {
    const projectRoot = await temporaryProject();
    const event = await waitForBoardEvent(projectRoot, 50);

    expect(event).toEqual({ timedOut: true });
  });

  it("ignores a stale lock and keeps the lock file for diagnosis", async () => {
    const projectRoot = await temporaryProject();
    const fittingRoom = path.join(projectRoot, ".fittingroom");

    await mkdir(fittingRoom, { recursive: true });
    await writeFile(
      path.join(fittingRoom, "board.lock"),
      `${JSON.stringify({
        version: 1,
        pid: 999_999,
        port: 4173,
        token: "stale",
        url: "http://127.0.0.1:4173/?token=stale",
        createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      })}\n`,
    );

    expect(await readLiveBoardLock(projectRoot)).toBeNull();
  });

  it("finds a live lock and persists the board state exactly", async () => {
    const projectRoot = await temporaryProject();
    const state = {
      ...emptyBoardState(),
      scope: { id: "marketing", name: "Marketing" },
      round: 2,
      status: "directions_ready" as const,
      variants: [
        {
          slug: "refined",
          name: "Refined",
          rationale: "Keeps the current style.",
          slot: 1,
          pinned: false,
        },
      ],
    };

    await writeBoardState(projectRoot, state);
    await writeBoardLock(projectRoot, {
      pid: process.pid,
      port: 4321,
      token: "live-token",
      url: "http://127.0.0.1:4321/?token=live-token",
    });

    expect(await readBoardState(projectRoot)).toEqual(state);
    expect(await readLiveBoardLock(projectRoot)).toMatchObject({
      pid: process.pid,
      port: 4321,
      token: "live-token",
    });
    expect(
      JSON.parse(await readFile(path.join(projectRoot, ".fittingroom", "board.json"), "utf8")),
    ).toEqual(state);
  });
});
