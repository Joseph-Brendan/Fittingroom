import { type ChildProcess, execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface FixtureCase {
  name: string;
  port: number;
}

interface FixturePackage {
  private?: boolean;
  scripts?: Record<string, string>;
}

const fixtures: FixtureCase[] = [
  { name: "bad-ui", port: 3000 },
  { name: "good-ui", port: 3001 },
];

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function fixtureRoot(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}

function homeUrl(port: number): string {
  return `http://localhost:${port}`;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }

    child.once("exit", (code) => resolve(code));
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }

  const exited = waitForExit(child);

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], () => resolve());
    });
    await exited;
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    void error;
    child.kill("SIGTERM");
  }

  const forceKill = setTimeout(() => {
    try {
      if (child.pid !== undefined) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch (error) {
      void error;
    }
  }, 5_000);

  await exited;
  clearTimeout(forceKill);
}

async function waitForHomePage(
  fixture: FixtureCase,
  child: ChildProcess,
  output: () => string,
  startupError: () => Error | undefined,
): Promise<number> {
  const url = homeUrl(fixture.port);
  const deadline = Date.now() + 30_000;
  let lastProblem = "No response yet.";

  while (Date.now() < deadline) {
    const spawnError = startupError();

    if (spawnError !== undefined) {
      throw new Error(`Could not start the ${fixture.name} dev script. ${spawnError.message}`);
    }

    if (child.exitCode !== null) {
      throw new Error(
        `${fixture.name} dev script exited with code ${child.exitCode} before ${url} returned status 200. Output: ${output()}`,
      );
    }

    try {
      const response = await fetch(url);

      if (response.status === 200) {
        return response.status;
      }

      lastProblem = `The server returned status ${response.status}.`;
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `${fixture.name} did not serve ${url} with status 200 within 30 seconds. ${lastProblem} Output: ${output()}`,
  );
}

for (const fixture of fixtures) {
  describe(`${fixture.name} fixture`, () => {
    it(`has a dev script and serves its home page on port ${fixture.port}`, async () => {
      const root = fixtureRoot(fixture.name);
      let packageJson: FixturePackage;

      try {
        packageJson = JSON.parse(
          await readFile(path.join(root, "package.json"), "utf8"),
        ) as FixturePackage;
      } catch (error) {
        throw new Error(
          `fixtures/${fixture.name}/package.json is missing or unreadable. Add a package.json with "dev" and "start" scripts. ${String(error)}`,
        );
      }

      expect(
        packageJson.scripts?.dev,
        `fixtures/${fixture.name}/package.json needs a "dev" script.`,
      ).toBeTypeOf("string");
      expect(
        packageJson.scripts?.start,
        `fixtures/${fixture.name}/package.json needs a "start" script.`,
      ).toBeTypeOf("string");
      expect(
        packageJson.private,
        `fixtures/${fixture.name}/package.json must set "private": true.`,
      ).toBe(true);

      let output = "";
      let spawnError: Error | undefined;
      const child = spawn(pnpmCommand, ["run", "dev"], {
        cwd: root,
        detached: process.platform !== "win32",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.once("error", (error) => {
        spawnError = error;
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      try {
        const status = await waitForHomePage(
          fixture,
          child,
          () => output,
          () => spawnError,
        );
        expect(status).toBe(200);
      } finally {
        await stop(child);
      }
    }, 60_000);
  });
}
