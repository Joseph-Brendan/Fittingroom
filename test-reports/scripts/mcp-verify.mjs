import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const [appRoot, route, handoffId] = process.argv.slice(2);

if (appRoot === undefined || route === undefined || handoffId === undefined) {
  throw new Error("Usage: mcp-verify.mjs <app-root> <route> <handoff-id>");
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
const client = new Client({ name: "release-test-verify", version: "0.0.0" });

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

const result = await client.callTool({
  name: "fr_verify",
  arguments: { route, handoffId },
});
const report = parseJson(result.content);

console.log("Passed:", report.passed);
console.log(
  "Region diffs:",
  report.regionDiffs
    .map((region) => `${region.name}:${region.differencePercent.toFixed(2)}%`)
    .join(", "),
);
console.log("Token mismatches:", report.tokenMismatches.length);
console.log("Order mismatches:", report.orderMismatches.length);
console.log(
  "Screenshots:",
  report.screenshots.map((screenshot) => `${screenshot.width}:${screenshot.path}`).join(", "),
);

await client.close();

if (report.passed !== true) {
  process.exitCode = 1;
}
