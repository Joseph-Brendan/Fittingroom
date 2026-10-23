import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const [appRoot, scope, route] = process.argv.slice(2);

if (appRoot === undefined || scope === undefined || route === undefined) {
  throw new Error("Usage: mcp-real-app.mjs <app-root> <scope> <route>");
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
const client = new Client({ name: "release-test-real-app", version: "0.0.0" });

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
const toolNames = tools.tools.map((tool) => tool.name);
console.log(`${appRoot}`);
console.log("Tools:", toolNames.join(", "));
console.log(
  "Missing expected tools:",
  ["fr_design_memory", "fr_states"].filter((name) => !toolNames.includes(name)).join(", ") ||
    "none",
);

const scopes = parseJson((await client.callTool({ name: "fr_scopes", arguments: {} })).content);
console.log(
  "Scopes:",
  scopes.scopes.map((entry) => `${entry.id}:${entry.routes.join(",")}`).join(" | "),
);

const audit = parseJson(
  (await client.callTool({ name: "fr_audit", arguments: { scope } })).content,
);
const page = audit.pages.find((candidate) => candidate.path === route) ?? audit.pages[0];
const screenshot = page.screenshots.find((entry) => entry.width === 1440) ?? page.screenshots[0];

console.log("Audit pages:", audit.pages.map((candidate) => candidate.path).join(", "));
console.log("Automated findings:", audit.findings.length);
console.log("Critique brief has screenshots:", audit.critiqueBrief.includes(screenshot.path));

const invalid = await client.callTool({
  name: "fr_submit_findings",
  arguments: {
    findings: [
      {
        citation: "nielsen-h99",
        confidence: "judged",
        evidence: "Made-up citation.",
        fix: "Use a real citation.",
        severity: 2,
        title: "Made-up finding",
      },
    ],
  },
});
console.log("Invalid citation rejected:", invalid.isError === true);

const judgedFinding =
  scope === "auth"
    ? {
        citation: "nielsen-h3",
        confidence: "judged",
        evidence: {
          measuredValue: "The login form has no password recovery link.",
          screenshotPath: screenshot.path,
          selector: "main",
        },
        fix: "Add a Forgot password link on the login page.",
        severity: 2,
        title: "No password recovery path on the login page",
      }
    : {
        citation: "nielsen-h1",
        confidence: "judged",
        evidence: {
          measuredValue: "The traffic chart has no loading, empty or error state.",
          screenshotPath: screenshot.path,
          selector: ".bars",
        },
        fix: "Add loading, empty and error states to the traffic chart.",
        severity: 2,
        title: "Dashboard chart has no loading or empty state",
      };

const submitted = parseJson(
  (
    await client.callTool({
      name: "fr_submit_findings",
      arguments: { findings: [judgedFinding] },
    })
  ).content,
);
console.log("Submitted counts:", JSON.stringify(submitted.counts));

const directions = parseJson(
  (await client.callTool({ name: "fr_directions", arguments: { route } })).content,
);
console.log("Directions surface:", directions.surface);
console.log(
  "Directions slots:",
  directions.slots.map((slot) => `${slot.slot}:${slot.role}:${slot.direction.name}`).join(" | "),
);

const slop = parseJson((await client.callTool({ name: "fr_slop", arguments: {} })).content);
console.log("Slop score:", slop.score);
console.log("Slop rules:", slop.rules.length);
console.log("Slop score card:", slop.scoreCardPath);

await client.close();
