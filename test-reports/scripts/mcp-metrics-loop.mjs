import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const appRoot = "/Users/josephbrendan/Documents/fr-test-apps/metrics-dashboard";
const variantsRoot = path.join(appRoot, "variants");
const require = createRequire(pathToFileURL(`${repoRoot}/packages/mcp/package.json`));
const indexPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
const stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
const { Client } = await import(pathToFileURL(indexPath).href);
const { StdioClientTransport } = await import(pathToFileURL(stdioPath).href);

function variantSource(functionName, heading, accent) {
  return `const days = [
  { label: "Mon", height: 42 },
  { label: "Tue", height: 58 },
  { label: "Wed", height: 51 },
  { label: "Thu", height: 73 },
  { label: "Fri", height: 66 },
  { label: "Sat", height: 81 },
  { label: "Sun", height: 77 },
];

export default function ${functionName}() {
  return (
    <>
      <style>{"*, *::before, *::after { box-sizing: border-box; } body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f5f7fa; }"}</style>
      <main style={{ minHeight: "100vh", padding: 36, background: "#f5f7fa", color: "#17202a", fontFamily: "ui-sans-serif, system-ui, sans-serif", lineHeight: 1.5 }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em" }}>${heading}</h1>
          <p style={{ margin: "0 0 28px", color: "#5b6775" }}>The last seven days across every workspace.</p>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28 }}>
            {[["Page views", "128,420"], ["Sessions", "42,118"], ["Bounce rate", "31.4%"], ["Median load", "1.8s"]].map(([label, value]) => (
              <article key={label} style={{ border: "1px solid #d8dee6", borderRadius: 12, padding: 20, background: "#ffffff" }}>
                <p style={{ margin: "0 0 8px", color: "#5b6775", fontSize: 14 }}>{label}</p>
                <p style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>{value}</p>
              </article>
            ))}
          </section>
          <section style={{ border: "1px solid #d8dee6", borderRadius: 12, padding: 20, background: "#ffffff" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Traffic by day</h2>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 220 }}>
              {days.map((day) => (
                <div key={day.label} style={{ display: "grid", gap: 8, justifyItems: "center", height: "100%", alignContent: "end", flex: 1 }}>
                  <span style={{ width: "100%", maxWidth: 42, height: day.height + "%", borderRadius: "6px 6px 0 0", background: "${accent}" }} />
                  <small style={{ color: "#5b6775", fontSize: 12 }}>{day.label}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
`;
}

await mkdir(variantsRoot, { recursive: true });
await writeFile(
  path.join(variantsRoot, "refined.tsx"),
  variantSource("RefinedDashboard", "Dashboard", "#1d4ed8"),
);
await writeFile(
  path.join(variantsRoot, "native.tsx"),
  variantSource("NativeDashboard", "Team overview", "#0f766e"),
);
await writeFile(
  path.join(variantsRoot, "bold.tsx"),
  variantSource("BoldDashboard", "Command center", "#b45309"),
);
await writeFile(
  path.join(variantsRoot, "wildcard.tsx"),
  variantSource("WildcardDashboard", "Signal board", "#4338ca"),
);
await writeFile(
  path.join(variantsRoot, "bad-render.tsx"),
  'export default function BadRender() {\n  throw new Error("This variant does not render.");\n}\n',
);
await writeFile(
  path.join(variantsRoot, "bad-image.tsx"),
  'export default function BadImage() {\n  return <main style={{ padding: 32, background: "#ffffff" }}><h1>Dashboard</h1><img src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27120%27 height=%2780%27%3E%3C/svg%3E" width="120" height="80" /></main>;\n}\n',
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`${repoRoot}/packages/mcp/dist/bin.js`],
  cwd: appRoot,
  env: { ...process.env },
});
const client = new Client({ name: "release-test-metrics-variants", version: "0.0.0" });

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
await client.callTool({ name: "fr_audit", arguments: { scope: "dashboard" } });
await client.callTool({ name: "fr_directions", arguments: { route: "/dashboard" } });

const accepted = [];
for (const [slug, file] of [
  ["refined", "variants/refined.tsx"],
  ["native", "variants/native.tsx"],
  ["bold", "variants/bold.tsx"],
  ["wildcard", "variants/wildcard.tsx"],
]) {
  const result = parseJson(
    (
      await client.callTool({
        name: "fr_register_variant",
        arguments: {
          slug,
          filePath: file,
          rationale: `${slug} keeps the dashboard clear and easy to scan.`,
        },
      })
    ).content,
  );
  console.log(
    `${slug}: accepted=${result.accepted} newFailures=${result.newFailures.length} errors=${result.errors.length}`,
  );
  if (result.accepted) accepted.push(slug);
}

for (const [slug, file] of [
  ["bad-render", "variants/bad-render.tsx"],
  ["bad-image", "variants/bad-image.tsx"],
]) {
  const result = parseJson(
    (
      await client.callTool({
        name: "fr_register_variant",
        arguments: { slug, filePath: file, rationale: "A deliberately bad variant." },
      })
    ).content,
  );
  console.log(
    `${slug}: accepted=${result.accepted} renderErrors=${result.renderErrors.length} newFailures=${result.newFailures.length}`,
  );
}

if (accepted[0] !== undefined) {
  const handoff = parseJson(
    (await client.callTool({ name: "fr_handoff", arguments: { variantSlug: accepted[0] } }))
      .content,
  );
  console.log("Handoff folder:", handoff.folder);
  console.log("Handoff files:", (await readdir(handoff.folder)).sort().join(", "));
}

await client.close();
