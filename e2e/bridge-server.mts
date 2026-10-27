import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBoardCommand } from "../packages/cli/src/board-command";

async function main(): Promise<void> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "fitroom-bridge-e2e-"));
  const sessionPath = path.resolve("e2e", ".bridge-session.json");
  const fixtureRoot = fileURLToPath(new URL("../fixtures/scope-app", import.meta.url));

  await rm(sessionPath, { force: true });
  await cp(fixtureRoot, projectRoot, { recursive: true });
  await rm(path.join(projectRoot, ".fitroom"), { force: true, recursive: true });
  await symlink(path.resolve("node_modules"), path.join(projectRoot, "node_modules"), "dir");

  const { url, token, close } = await runBoardCommand({ port: 4175, projectRoot });

  await writeFile(sessionPath, `${JSON.stringify({ projectRoot, token, url }, null, 2)}\n`);

  const shutdown = async () => {
    await close();
    await rm(projectRoot, { force: true, recursive: true });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stdout.write(`Fitroom bridge board ready at ${url}\n`);
}

void main();
