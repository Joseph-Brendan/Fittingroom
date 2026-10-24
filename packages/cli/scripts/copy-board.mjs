import { access, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = path.resolve(cliRoot, "..", "board", "dist");
const destination = path.resolve(cliRoot, "dist", "board");

try {
  await access(path.join(source, "index.html"));
} catch {
  throw new Error("The board build was not found. Run the board build first.");
}

await rm(destination, { force: true, recursive: true });
await cp(source, destination, { recursive: true });
