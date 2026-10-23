import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/josephbrendan/Documents/fittingroom";
const appRoot = "/Users/josephbrendan/Documents/fr-test-apps/shop-app";
const variantsRoot = path.join(appRoot, "variants");
const require = createRequire(pathToFileURL(`${repoRoot}/packages/mcp/package.json`));
const indexPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
const stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
const { Client } = await import(pathToFileURL(indexPath).href);
const { StdioClientTransport } = await import(pathToFileURL(stdioPath).href);

function variantSource(functionName, heading, accent) {
  return `export default function ${functionName}() {
  return (
    <>
      <style>{"*, *::before, *::after { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; background: #ffffff; }"}</style>
      <main style={{ minHeight: "100vh", padding: 32, background: "#ffffff", color: "#0d2b28", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <section style={{ maxWidth: 480, margin: "0 auto", border: "1px solid #d7e3df", borderRadius: 18, padding: 32 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em" }}>${heading}</h1>
        <p style={{ margin: "0 0 24px", color: "#4f6b66" }}>Use the email you signed up with.</p>
        <form>
          <label htmlFor="variant-email" style={{ display: "block", marginBottom: 6, fontWeight: 700 }}>Email</label>
          <input id="variant-email" type="email" style={{ width: "100%", minHeight: 44, marginBottom: 16, padding: 10, border: "1px solid #74777d", borderRadius: 10, font: "inherit" }} />
          <label htmlFor="variant-password" style={{ display: "block", marginBottom: 6, fontWeight: 700 }}>Password</label>
          <input id="variant-password" type="password" style={{ width: "100%", minHeight: 44, marginBottom: 20, padding: 10, border: "1px solid #74777d", borderRadius: 10, font: "inherit" }} />
          <button type="submit" style={{ minHeight: 44, padding: "12px 18px", border: 0, borderRadius: 10, background: "${accent}", color: "#ffffff", font: "inherit", fontWeight: 700 }}>Log in</button>
        </form>
      </section>
      </main>
    </>
  );
}
`;
}

await mkdir(variantsRoot, { recursive: true });
await writeFile(
  path.join(variantsRoot, "refined.tsx"),
  variantSource("RefinedLogin", "Welcome back", "#0f766e"),
);
await writeFile(
  path.join(variantsRoot, "native.tsx"),
  variantSource("NativeLogin", "Log in to Northwind", "#115e59"),
);
await writeFile(
  path.join(variantsRoot, "bold.tsx"),
  variantSource("BoldLogin", "Get back to work", "#b45309"),
);
await writeFile(
  path.join(variantsRoot, "wildcard.tsx"),
  variantSource("WildcardLogin", "Your studio is waiting", "#4338ca"),
);
await writeFile(
  path.join(variantsRoot, "bad-render.tsx"),
  'export default function BadRender() {\n  throw new Error("This variant does not render.");\n}\n',
);
await writeFile(
  path.join(variantsRoot, "bad-contrast.tsx"),
  'export default function BadContrast() {\n  return <main style={{ padding: 32, background: "#ffffff" }}><p style={{ color: "#eeeeee" }}>Low contrast text</p></main>;\n}\n',
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`${repoRoot}/packages/mcp/dist/bin.js`],
  cwd: appRoot,
  env: { ...process.env },
});
const client = new Client({ name: "release-test-variants", version: "0.0.0" });

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
await client.callTool({ name: "fr_audit", arguments: { scope: "auth" } });
await client.callTool({ name: "fr_directions", arguments: { route: "/login" } });

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
          rationale: `${slug} keeps the login task clear and easy to scan.`,
        },
      })
    ).content,
  );

  console.log(
    `${slug}: accepted=${result.accepted} newFailures=${result.newFailures.length} errors=${result.errors.length}`,
  );

  if (result.accepted) {
    accepted.push(slug);
  }
}

for (const [slug, file] of [
  ["bad-render", "variants/bad-render.tsx"],
  ["bad-contrast", "variants/bad-contrast.tsx"],
]) {
  const result = parseJson(
    (
      await client.callTool({
        name: "fr_register_variant",
        arguments: {
          slug,
          filePath: file,
          rationale: "A deliberately bad variant.",
        },
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
  const files = await readdir(handoff.folder);

  console.log("Handoff folder:", handoff.folder);
  console.log("Handoff files:", files.sort().join(", "));
}

await client.close();
