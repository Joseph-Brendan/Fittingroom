import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const appRoot = `${repoRoot}/fixtures/bad-ui`;
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
const client = new Client({ name: "release-test-judged", version: "0.0.0" });

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

function screenshotFor(payload, route) {
  const page = payload.pages.find((candidate) => candidate.path === route);

  if (page === undefined) {
    throw new Error(`Missing page ${route}.`);
  }

  return page.screenshots.find((entry) => entry.width === 1440)?.path ?? page.screenshots[0].path;
}

await client.connect(transport);

const settingsAudit = parseJson(
  (await client.callTool({ name: "fr_audit", arguments: { scope: "settings" } })).content,
);
const settingsShot = screenshotFor(settingsAudit, "/settings");
const settingsSubmit = parseJson(
  (
    await client.callTool({
      name: "fr_submit_findings",
      arguments: {
        findings: [
          {
            citation: "nielsen-h5",
            confidence: "judged",
            evidence: {
              measuredValue: "The Delete project button deletes without a confirmation step.",
              screenshotPath: settingsShot,
              selector: "#delete-project",
            },
            fix: "Ask for confirmation before deleting the project.",
            severity: 3,
            title: "Delete project has no confirmation",
          },
          {
            citation: "nielsen-h1",
            confidence: "judged",
            evidence: {
              measuredValue: "The Save changes button has no loading or saved state.",
              screenshotPath: settingsShot,
              selector: "#save-changes",
            },
            fix: "Show a loading state and a saved confirmation.",
            severity: 2,
            title: "Save changes has no saved state",
          },
        ],
      },
    })
  ).content,
);
console.log("Settings judged counts:", JSON.stringify(settingsSubmit.counts));

const dashboardAudit = parseJson(
  (await client.callTool({ name: "fr_audit", arguments: { scope: "dashboard" } })).content,
);
const dashboardShot = screenshotFor(dashboardAudit, "/dashboard");
const dashboardSubmit = parseJson(
  (
    await client.callTool({
      name: "fr_submit_findings",
      arguments: {
        findings: [
          {
            citation: "nielsen-h2",
            confidence: "judged",
            evidence: {
              measuredValue: "The dashboard copy says instantiate a new telemetry pipeline.",
              screenshotPath: dashboardShot,
              selector: "main",
            },
            fix: "Use plain words for the action, such as create a new data pipeline.",
            severity: 2,
            title: "Dashboard copy uses jargon",
          },
        ],
      },
    })
  ).content,
);
console.log("Dashboard judged counts:", JSON.stringify(dashboardSubmit.counts));

await client.close();
