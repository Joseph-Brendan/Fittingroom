import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const appRoot = `${repoRoot}/fixtures/bad-ui`;

await rm(`${appRoot}/.fittingroom/history.json`, { force: true });

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
const client = new Client({ name: "release-test-regenerate", version: "0.0.0" });

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
await client.callTool({ name: "fr_audit", arguments: { scope: "marketing" } });

const seen = new Map();
let slotOneRefined = true;

for (let round = 1; round <= 5; round += 1) {
  const result = parseJson(
    (await client.callTool({ name: "fr_regenerate", arguments: { scope: "marketing" } })).content,
  );
  const slotOne = result.slots.find((slot) => slot.slot === 1);
  const nonRefined = result.slots.filter((slot) => slot.slot !== 1);

  if (slotOne?.role !== "refined" || slotOne?.directionSlug !== null) {
    slotOneRefined = false;
  }

  for (const slot of nonRefined) {
    const slug = slot.directionSlug;
    const rounds = seen.get(slug) ?? [];

    rounds.push(round);
    seen.set(slug, rounds);
  }

  console.log(
    `Round ${round}: changed=${result.changedSlots.join(",")} slot1=${slotOne?.role}/${String(
      slotOne?.directionSlug,
    )} slots2to4=${nonRefined.map((slot) => slot.directionSlug).join(",")}`,
  );
}

const repeats = [...seen.entries()].filter(([, rounds]) => rounds.length > 1);

console.log("Slot 1 always refined:", slotOneRefined ? "yes" : "no");
console.log("Repeated directions:", repeats.length === 0 ? "none" : JSON.stringify(repeats));

await client.close();

if (!slotOneRefined || repeats.length > 0) {
  process.exitCode = 1;
}
