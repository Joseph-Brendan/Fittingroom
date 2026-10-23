import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const appRoot = `${repoRoot}/fixtures/bad-ui`;
const boardUrl = process.argv[2];

if (boardUrl === undefined) {
  throw new Error("Pass the board URL with token.");
}

const require = createRequire(pathToFileURL(`${repoRoot}/packages/mcp/package.json`));
const indexPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
const stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
const { Client } = await import(pathToFileURL(indexPath).href);
const { StdioClientTransport } = await import(pathToFileURL(stdioPath).href);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`${repoRoot}/packages/mcp/dist/bin.js`],
  cwd: appRoot,
  env: { ...process.env },
});
const client = new Client({ name: "release-test-round-3", version: "0.0.0" });

function parseJson(content) {
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      return JSON.parse(item.text);
    }
  }

  throw new Error("Tool result did not include text content.");
}

await client.connect(transport);

const tools = await client.listTools();
console.log("Tools:", tools.tools.map((tool) => tool.name).join(", "));

const scopes = parseJson((await client.callTool({ name: "fr_scopes", arguments: {} })).content);
console.log(
  "Scopes:",
  scopes.scopes.map((scope) => `${scope.id}:${scope.routes.join(",")}`).join(" | "),
);

const audit = parseJson(
  (await client.callTool({ name: "fr_audit", arguments: { scope: "marketing" } })).content,
);
console.log("Audit pages:", audit.pages.map((page) => page.path).join(", "));
console.log("Audit findings:", audit.findings.length);

const directions = parseJson(
  (await client.callTool({ name: "fr_directions", arguments: { route: "/" } })).content,
);
console.log("Directions route:", directions.route);
console.log(
  "Directions slots:",
  directions.slots.map((slot) => `${slot.slot}:${slot.role}:${slot.direction.name}`).join(" | "),
);

const boardToken = new URL(boardUrl).searchParams.get("token");
const boardOrigin = new URL(boardUrl).origin;
const boardState = await fetch(`${boardOrigin}/api/board?token=${boardToken}`).then((response) =>
  response.json(),
);
console.log("Board variants:", boardState.variants.length);
console.log("Board empty state:", boardState.variants.length === 0 ? "yes" : "no");

await client.close();

if (directions.slots.length !== 4) {
  console.error("Expected 4 directions.");
  process.exitCode = 1;
}

if (boardState.variants.length !== 4) {
  console.error("The board did not receive the 4 directions.");
  process.exitCode = 1;
}
