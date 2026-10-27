import { type ChildProcess, execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

let packageName = "";
let tarballName = "";

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

async function remoteOwner(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
  });
  const owner = stdout.trim().match(/github\.com[:/]([^/]+)\//i)?.[1];

  if (owner === undefined) {
    throw new Error("Could not read the GitHub owner from origin.");
  }

  return owner;
}

async function run(file: string, args: readonly string[], cwd: string): Promise<CommandOutput> {
  return execFileAsync(file, args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === "win32" && file.endsWith(".cmd"),
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
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-pack-"));
  projectRoot = path.join(temporaryDirectory, "app");
  strangerRoot = path.join(temporaryDirectory, "stranger");
  const manifest = JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8")) as {
    name?: unknown;
    version?: unknown;
  };

  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error("packages/cli/package.json needs a name and version.");
  }

  packageName = manifest.name;
  tarballName = `${manifest.name}-${manifest.version}.tgz`;

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
  it("makes one tarball from the package name and version", async () => {
    const archives = (await readdir(path.dirname(tarballPath))).filter((file) =>
      file.endsWith(".tgz"),
    );

    expect(archives).toEqual([tarballName]);
  });

  it("keeps a fitroom bin entry that points at the built script", async () => {
    const manifest = JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8")) as {
      bin?: unknown;
      mcpName?: unknown;
      name?: unknown;
    };
    const owner = await remoteOwner();

    expect(manifest.mcpName).toBe(`io.github.${owner}/${manifest.name}`);
    expect(manifest.bin).toMatchObject({ fitroom: "dist/index.js" });

    const entry = path.join(cliRoot, "dist", "index.js");
    const firstLine = (await readFile(entry, "utf8")).split("\n")[0];

    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("uses the package name in the MCP install commands", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");

    expect(readme).toContain(`npx ${packageName}`);
    expect(readme).toContain(`npx -y ${packageName} mcp`);
    expect(readme).toContain(`claude mcp add fitroom -- npx -y ${packageName} mcp`);
    expect(readme).toContain(`"args": ["-y", "${packageName}", "mcp"]`);
    expect(readme).toContain(`npm install -g ${packageName}`);
  });

  it("lists the package files and no fixtures, tests, reports or env files", async () => {
    const { stdout } = await run(npmCommand, ["pack", "--dry-run", "--json"], cliRoot);
    const packages = JSON.parse(stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = packages.flatMap((entry) => entry.files.map((file) => file.path));

    expect(files).toContain("dist/board/index.html");

    for (const file of files) {
      expect(file === "package.json" || file === "README.md" || file.startsWith("dist/")).toBe(
        true,
      );
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
    const child = execFile(
      process.execPath,
      [installedEntry, "board", "--url", badServer.origin, "--port", "0"],
      {
        cwd: projectRoot,
      },
    );
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
