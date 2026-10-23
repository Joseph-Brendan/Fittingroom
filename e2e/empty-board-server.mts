import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { startBoardServer } from "../packages/cli/src/board-server";

async function main(): Promise<void> {
  const sessionPath = path.resolve("e2e", ".empty-board-session.json");

  await rm(sessionPath, { force: true });

  const { url, token, close } = await startBoardServer({
    port: 4174,
    state: {
      scope: { id: "marketing", name: "Marketing" },
      scopes: [
        { id: "marketing", name: "Marketing" },
        { id: "auth", name: "Authentication" },
        { id: "dashboard", name: "Dashboard" },
      ],
      variants: [],
      findings: [],
      previousRounds: [],
    },
  });

  await writeFile(sessionPath, `${JSON.stringify({ token, url }, null, 2)}\n`);

  const shutdown = async () => {
    await close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stdout.write(`Empty Fitting Room board ready at ${url}\n`);
}

void main();
