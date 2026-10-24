import { type ChildProcess, execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const execFileAsync = promisify(execFile);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const packageName = "fitting-room";
const packageVersion = "0.0.0";
const tarballName = `${packageName}-${packageVersion}.tgz`;

interface CommandOutput {
  stderr: string;
  stdout: string;
}

let badServer: FixtureServer;
let projectRoot: string;
let strangerRoot: string;
let tarballPath: string;
let temporaryDirectory: string;

function requireFromMcp(name: string): string {
  const require = createRequire(pathToFileURL(path.join(repoRoot, "packages/mcp/package.json")));

  return require.resolve(name);
}

async function run(file: string, args: readonly string[], cwd: string): Promise<CommandOutput> {
  return execFileAsync(file, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 600_000,
  });
}

function stopProcess(child: ChildProcess | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

async function packTarball(): Promise<string> {
  const packDirectory = path.join(temporaryDirectory, "pack");

  await mkdir(packDirectory, { recursive: true });
  await run(npmCommand, ["pack", "--pack-destination", packDirectory], cliRoot);

  const archives = (await readdir(packDirectory)).filter((file) => file.endsWith(".tgz"));

  expect(archives).toHaveLength(1);

  return path.join(packDirectory, archives[0] ?? "");
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-pack-"));
  projectRoot = path.join(temporaryDirectory, "app");
  strangerRoot = path.join(temporaryDirectory, "stranger");

  await mkdir(projectRoot, { recursive: true });
  await mkdir(strangerRoot, { recursive: true });
  await cp(path.join(fixturePath("bad-ui"), "app"), path.join(projectRoot, "app"), {
    recursive: true,
  });
  await run(pnpmCommand, ["build"], repoRoot);
  tarballPath = await packTarball();
  badServer = await startFixtureServer(fixturePath("bad-ui"));
}, 600_000);

afterAll(async () => {
  await badServer.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("npm pack", () => {
  it("makes one tarball named fitting-room", async () => {
    const archives = (await readdir(path.dirname(tarballPath))).filter((file) =>
      file.endsWith(".tgz"),
    );

    expect(archives).toEqual([tarballName]);
  });

  it("lists only dist files and no fixtures, tests, reports or env files", async () => {
    const { stdout } = await run(npmCommand, ["pack", "--dry-run", "--json"], cliRoot);
    const packages = JSON.parse(stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = packages.flatMap((entry) => entry.files.map((file) => file.path));

    expect(files).toContain("dist/board/index.html");

    for (const file of files) {
      expect(file === "package.json" || file.startsWith("dist/")).toBe(true);
      expect(file).not.toMatch(/(^|\/)(fixtures|test|test-reports|src)(\/|$)/);
      expect(file).not.toMatch(/\.env/);
    }
  }, 300_000);
});

describe("installed package", () => {
  let installedEntry: string;

  beforeAll(async () => {
    await run(npmCommand, ["install", tarballPath], strangerRoot);
    installedEntry = path.join(strangerRoot, "node_modules", packageName, "dist", "index.js");
  }, 600_000);

  it("runs fitroom --help with no module error", async () => {
    const { stdout, stderr } = await run(
      npxCommand,
      ["--no-install", "fitroom", "--help"],
      strangerRoot,
    );

    expect(stdout).toContain("Usage: fitroom");
    expect(`${stdout}${stderr}`).not.toContain("Cannot find module");
  }, 300_000);

  it("runs fitroom audit with no module error", async () => {
    const { stdout, stderr } = await run(
      process.execPath,
      [installedEntry, "audit", "--url", badServer.origin, "--scope", "marketing"],
      projectRoot,
    );

    expect(stdout).toContain("Automated findings:");
    expect(`${stdout}${stderr}`).not.toContain("Cannot find module");
  }, 300_000);

  it("runs fitroom board and serves the built board", async () => {
    const child = execFile(process.execPath, [installedEntry, "board", "--url", badServer.origin], {
      cwd: projectRoot,
    });
    let output = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    try {
      const deadline = Date.now() + 60_000;
      let boardUrl = "";

      while (Date.now() < deadline) {
        const match = output.match(/Board ready: (\S+)/);

        if (match?.[1] !== undefined) {
          boardUrl = match[1];
          break;
        }

        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`fitroom board exited before ready. ${output}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(boardUrl).not.toBe("");
      expect(output).not.toContain("Cannot find module");

      const response = await fetch(boardUrl);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain("root");
      expect(html).toContain("assets/");
    } finally {
      await stopProcess(child);
    }
  }, 300_000);

  it("runs fitroom mcp and lists the MCP tools", async () => {
    const indexPath = requireFromMcp("@modelcontextprotocol/sdk/client/index.js");
    const stdioPath = requireFromMcp("@modelcontextprotocol/sdk/client/stdio.js");
    const clientModule = (await import(
      pathToFileURL(indexPath).href
    )) as typeof import("@modelcontextprotocol/sdk/client/index.js");
    const stdioModule = (await import(
      pathToFileURL(stdioPath).href
    )) as typeof import("@modelcontextprotocol/sdk/client/stdio.js");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const transport = new stdioModule.StdioClientTransport({
      command: process.execPath,
      args: [installedEntry, "mcp"],
      cwd: projectRoot,
      env,
    });
    const client = new clientModule.Client({ name: "packaging-test", version: "0.0.0" });

    try {
      await client.connect(transport);

      const tools = await client.listTools();

      expect(tools.tools.map((tool) => tool.name)).toContain("fr_scopes");
    } finally {
      await client.close();
    }
  }, 300_000);
});
