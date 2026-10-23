import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("../../../fixtures/bad-ui", import.meta.url));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const blockLocalHttpPath = fileURLToPath(
  new URL("./helpers/block-local-http.mjs", import.meta.url),
);
const appUrl = "http://localhost:3000";
const appPort = 3000;

const boardState = {
  scope: { id: "marketing", name: "Marketing" },
  surface: "marketing",
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
};

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

interface RunningBoard {
  child: ChildProcess;
  output: () => string;
}

let devServer: ChildProcess | undefined;
let devOutput = "";

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
      return;
    }

    child.once("exit", (code) => resolve(code));
  });
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.pid === undefined) {
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = waitForExit(child);

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch (error) {
    void error;
    child.kill("SIGTERM");
  }

  const forceKill = setTimeout(() => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch (error) {
      void error;
    }
  }, 5_000);

  await exited;
  clearTimeout(forceKill);
}

async function resetFixtureState(): Promise<void> {
  await rm(path.join(fixtureRoot, ".fittingroom"), { force: true, recursive: true });
}

function portIsInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function startBadUiDevServer(): Promise<void> {
  await stopBadUiDevServer();

  if (await portIsInUse(appPort)) {
    throw new Error(
      `Port ${appPort} is already in use. Stop that process and run the tests again.`,
    );
  }

  devOutput = "";

  const child = spawn(pnpmCommand, ["run", "dev"], {
    cwd: fixtureRoot,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  devServer = child;
  child.stdout?.on("data", (chunk: Buffer) => {
    devOutput += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    devOutput += chunk.toString();
  });

  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`bad-ui dev server exited before it was ready. ${devOutput}`);
    }

    try {
      const response = await fetch(appUrl);

      if (response.status === 200) {
        return;
      }
    } catch (error) {
      void error;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`bad-ui dev server did not serve ${appUrl}. ${devOutput}`);
}

async function stopBadUiDevServer(): Promise<void> {
  const child = devServer;

  devServer = undefined;
  await stopProcess(child);
}

function runFitroom(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: fixtureRoot,
      env: { ...process.env, NO_COLOR: "1", ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`fitroom ${args.join(" ")} did not finish. ${stdout} ${stderr}`));
    }, options.timeoutMs ?? 120_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stderr, stdout });
    });
    child.stdin.end(options.input ?? "");
  });
}

async function writeBoardState(): Promise<void> {
  const stateRoot = path.join(fixtureRoot, ".fittingroom");

  await mkdir(stateRoot, { recursive: true });
  await writeFile(path.join(stateRoot, "board.json"), `${JSON.stringify(boardState, null, 2)}\n`);
}

async function startBoard(args: string[]): Promise<RunningBoard> {
  const child = spawn(process.execPath, [cliPath, "board", ...args], {
    cwd: fixtureRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (output.includes("Board ready:")) {
      return { child, output: () => output };
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`fitroom board exited before it was ready. ${output}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await stopProcess(child);
  throw new Error(`fitroom board did not become ready. ${output}`);
}

beforeAll(async () => {
  await execFileAsync(pnpmCommand, ["--filter", "@fittingroom/citations", "build"], {
    cwd: repoRoot,
  });
  await execFileAsync(pnpmCommand, ["--filter", "@fittingroom/core", "build"], {
    cwd: repoRoot,
  });
  await execFileAsync(pnpmCommand, ["--filter", "@fittingroom/cli", "build"], {
    cwd: repoRoot,
  });
}, 120_000);

afterAll(async () => {
  await stopBadUiDevServer();
  await resetFixtureState();
});

describe("fitroom binary", () => {
  it("shows the page picker when audit has a URL but no scope", async () => {
    await resetFixtureState();
    await startBadUiDevServer();

    try {
      const result = await runFitroom(["audit", "--url", appUrl], { input: "1\n" });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Page groups:");
      expect(result.stdout).toContain("Select a page group");
      expect(result.stdout).toContain("Capturing:");
    } finally {
      await stopBadUiDevServer();
    }
  }, 120_000);

  it("skips the picker for --scope and prints the summary before capture", async () => {
    await resetFixtureState();
    await startBadUiDevServer();

    try {
      const result = await runFitroom(["audit", "--url", appUrl, "--scope", "marketing"]);
      const summary = "Capturing: Marketing (2 pages): / /pricing, at 375, 768 and 1440 px.";
      const findings = "Automated findings: 3.";
      const summaryIndex = result.stdout.indexOf(summary);

      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("Select a page group");
      expect(result.stdout).not.toContain("Page groups:");
      expect(summaryIndex).toBeGreaterThanOrEqual(0);
      expect(result.stdout.indexOf(findings)).toBeGreaterThan(summaryIndex);
    } finally {
      await stopBadUiDevServer();
    }
  }, 120_000);

  it("captures only the pages passed with --pages", async () => {
    await resetFixtureState();
    await startBadUiDevServer();

    try {
      const result = await runFitroom(["audit", "--url", appUrl, "--pages", "/,/pricing"]);
      const captureRoot = path.join(fixtureRoot, ".fittingroom", "captures", "marketing");
      const auditRoot = path.join(fixtureRoot, ".fittingroom", "audits", "marketing");

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Capturing: Marketing (2 pages): / /pricing");
      expect((await readdir(captureRoot)).sort()).toEqual(["pricing", "root"]);
      expect((await readdir(auditRoot)).sort()).toEqual([
        "findings.json",
        "pricing",
        "report.html",
        "root",
      ]);
    } finally {
      await stopBadUiDevServer();
    }
  }, 120_000);

  it("auto-detects the running dev server when --url is omitted", async () => {
    await resetFixtureState();
    await startBadUiDevServer();

    try {
      const result = await runFitroom(["audit", "--scope", "marketing"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Capturing: Marketing (2 pages): / /pricing");
      expect(result.stdout).not.toContain("No local dev server found");
    } finally {
      await stopBadUiDevServer();
    }
  }, 120_000);

  it("tells the user to start the app or pass --url when no dev server is found", async () => {
    await stopBadUiDevServer();
    await resetFixtureState();

    const result = await runFitroom(["audit", "--scope", "marketing"], {
      env: { NODE_OPTIONS: `--import ${pathToFileURL(blockLocalHttpPath).href}` },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("No local dev server found");
    expect(result.stderr).toContain("Start your app");
    expect(result.stderr).toContain("--url");
  }, 60_000);

  it("starts the board when board gets --url", async () => {
    await resetFixtureState();
    await startBadUiDevServer();
    await writeBoardState();
    let board: RunningBoard | undefined;
    const statePath = path.join(fixtureRoot, ".fittingroom", "board.json");
    const before = await readFile(statePath, "utf8");

    try {
      board = await startBoard(["--url", appUrl]);

      expect(board.output()).toContain("Board ready:");
      expect(board.output()).toContain(`App URL: ${appUrl}`);
      expect(await readFile(statePath, "utf8")).toBe(before);
    } finally {
      await stopProcess(board?.child);
      await stopBadUiDevServer();
      await resetFixtureState();
    }
  }, 120_000);

  it("creates .fittingroom and a valid empty board.json when it is missing", async () => {
    await resetFixtureState();
    let board: RunningBoard | undefined;

    try {
      board = await startBoard(["--url", appUrl]);

      const statePath = path.join(fixtureRoot, ".fittingroom", "board.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        findings: unknown[];
        previousRounds: unknown[];
        scope: { id: string; name: string };
        scopes: Array<{ id: string; name: string }>;
        variants: unknown[];
      };

      expect(board.output()).toContain("Board ready:");
      expect(state.scope).toEqual({ id: "marketing", name: "Marketing" });
      expect(state.scopes).toHaveLength(7);
      expect(state.variants).toEqual([]);
      expect(state.findings).toEqual([]);
      expect(state.previousRounds).toEqual([]);
    } finally {
      await stopProcess(board?.child);
      await resetFixtureState();
    }
  }, 120_000);

  it("gives a plain error when board.json is corrupt", async () => {
    await resetFixtureState();
    await mkdir(path.join(fixtureRoot, ".fittingroom"), { recursive: true });
    await writeFile(path.join(fixtureRoot, ".fittingroom", "board.json"), '{"scope": ');

    try {
      const result = await runFitroom(["board", "--url", appUrl]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("board.json");
      expect(result.stderr).toContain("not valid JSON");
      expect(result.stderr).toContain("Fix the file or delete it");
      expect(result.stderr).not.toContain("    at ");
    } finally {
      await resetFixtureState();
    }
  }, 60_000);

  it("creates scopes.json when fitroom scopes runs with no .fittingroom", async () => {
    await resetFixtureState();

    try {
      const result = await runFitroom(["scopes"]);
      const state = JSON.parse(
        await readFile(path.join(fixtureRoot, ".fittingroom", "scopes.json"), "utf8"),
      ) as { scopes: unknown[] };

      expect(result.code).toBe(0);
      expect(state.scopes).toHaveLength(7);
    } finally {
      await resetFixtureState();
    }
  }, 60_000);

  it("keeps --version working after a command", async () => {
    const result = await runFitroom(["audit", "--version"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("0.0.0");
  });

  it("prints valid audit options for an unknown option", async () => {
    const result = await runFitroom(["audit", "--bogus"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown option --bogus");
    expect(result.stderr).toContain("--url");
    expect(result.stderr).toContain("--scope");
    expect(result.stderr).toContain("--pages");
  });

  it("prints valid board options for an unknown option", async () => {
    const result = await runFitroom(["board", "--scope", "marketing", "--bogus"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown option --bogus");
    expect(result.stderr).toContain("--url");
    expect(result.stderr).toContain("--scope");
    expect(result.stderr).toContain("--state");
  });

  it("lists every audit option with a description and an example", async () => {
    const result = await runFitroom(["audit", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: fitroom audit");
    expect(result.stdout).toContain("--url");
    expect(result.stdout).toContain("--scope");
    expect(result.stdout).toContain("--pages");
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("fitroom audit --url http://localhost:3000");
  });

  it("lists every board option with a description and an example", async () => {
    const result = await runFitroom(["board", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: fitroom board");
    expect(result.stdout).toContain("--url");
    expect(result.stdout).toContain("--scope");
    expect(result.stdout).toContain("--state");
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("fitroom board --url http://localhost:3000");
  });

  it("lists every scopes option with a description and an example", async () => {
    const result = await runFitroom(["scopes", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: fitroom scopes");
    expect(result.stdout).toContain("--name");
    expect(result.stdout).toContain("--pages");
    expect(result.stdout).toContain("--id");
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain('fitroom scopes rename auth "Sign in"');
  });
});
