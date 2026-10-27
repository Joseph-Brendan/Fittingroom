import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  type Finding,
  HANDOFF_HEIGHT,
  HANDOFF_STYLE_PROPERTIES,
  HANDOFF_WIDTHS,
  type HandoffReference,
  runAutomatedChecks,
} from "@fitroom/core";
import { build } from "esbuild";
import { chromium } from "playwright";

export interface PreviewResult {
  errors: string[];
  findings: Finding[];
  previewUrl: string | null;
  reference: HandoffReference | null;
  renderErrors: string[];
  screenshotPath: string | null;
}

const require = createRequire(import.meta.url);
const reactRoot = path.dirname(require.resolve("react/package.json"));
const reactDomRoot = path.dirname(require.resolve("react-dom/package.json"));
const reactAliases: Record<string, string> = {
  react: reactRoot,
  "react-dom": reactDomRoot,
  "react-dom/client": path.join(reactDomRoot, "client.js"),
  "react/jsx-runtime": path.join(reactRoot, "jsx-runtime.js"),
  "react/jsx-dev-runtime": path.join(reactRoot, "jsx-dev-runtime.js"),
};

function esbuildErrors(error: unknown): string[] {
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray(error.errors)
  ) {
    return error.errors.map((entry: unknown) => {
      if (typeof entry === "object" && entry !== null && "text" in entry) {
        return String(entry.text);
      }

      return String(entry);
    });
  }

  return [error instanceof Error ? error.message : "The variant did not bundle."];
}

function listen(server: ReturnType<typeof createServer>): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();

      if (address === null || typeof address === "string") {
        reject(new Error("The preview server did not return a TCP address."));
        return;
      }

      resolve(address);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

export async function previewVariant(
  projectRoot: string,
  filePath: string,
  slug: string,
): Promise<PreviewResult> {
  const previewRoot = path.join(projectRoot, ".fitroom", "previews", slug);
  const outputRoot = path.join(projectRoot, ".fitroom", "variants", slug);
  const routePrefix = `/__fitroom/preview/${encodeURIComponent(slug)}`;
  const entryPath = path.join(previewRoot, "entry.tsx");
  const bundlePath = path.join(previewRoot, "preview.js");
  const relativeVariant = path.relative(previewRoot, filePath).split(path.sep).join("/");
  const importPath = relativeVariant.startsWith(".") ? relativeVariant : `./${relativeVariant}`;
  const entry = [
    'import { createRoot } from "react-dom/client";',
    `import Variant from ${JSON.stringify(importPath)};`,
    'const root = document.getElementById("root");',
    'if (root === null) throw new Error("Missing preview root.");',
    "createRoot(root).render(<Variant />);",
  ].join("\n");

  await mkdir(previewRoot, { recursive: true });
  await writeFile(entryPath, `${entry}\n`);

  try {
    await build({
      alias: reactAliases,
      bundle: true,
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      entryPoints: [entryPath],
      format: "iife",
      jsx: "automatic",
      logLevel: "silent",
      outfile: bundlePath,
      platform: "browser",
      target: ["es2020"],
    });
  } catch (error) {
    return {
      errors: esbuildErrors(error),
      findings: [],
      previewUrl: null,
      reference: null,
      renderErrors: [],
      screenshotPath: null,
    };
  }

  const cssPath = path.join(previewRoot, "preview.css");
  const cssLink = (await fileExists(cssPath))
    ? `<link rel="stylesheet" href="${routePrefix}/preview.css">`
    : "";
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>Variant preview: ${slug}</title>`,
    cssLink,
    "<style>body { margin: 0; }</style>",
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script defer src="${routePrefix}/preview.js"></script>`,
    "</body>",
    "</html>",
  ]
    .filter((line) => line !== "")
    .join("\n");

  await writeFile(path.join(previewRoot, "index.html"), `${html}\n`);

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (pathname === routePrefix || pathname === `${routePrefix}/`) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    if (!pathname.startsWith(`${routePrefix}/`)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const requestedFile = pathname.slice(routePrefix.length + 1);
    const requestedPath = path.resolve(previewRoot, requestedFile);

    if (!requestedPath.startsWith(`${previewRoot}${path.sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const content = await readFile(requestedPath);

      response.writeHead(200, { "content-type": contentType(requestedPath) });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  const address = await listen(server);
  const previewUrl = `http://127.0.0.1:${address.port}${routePrefix}`;
  const renderErrors: string[] = [];
  const browser = await chromium.launch({ headless: true });
  let reference: HandoffReference | null = null;
  let screenshotPath: string | null = null;

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    page.on("pageerror", (error) => {
      renderErrors.push(error.message);
    });

    try {
      await page.goto(previewUrl, { waitUntil: "load", timeout: 15_000 });
      await page.waitForFunction(
        () => (document.getElementById("root")?.childElementCount ?? 0) > 0,
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(150);
    } catch (error) {
      renderErrors.push(error instanceof Error ? error.message : "The variant did not render.");
    }

    if (renderErrors.length === 0) {
      await mkdir(outputRoot, { recursive: true });
      screenshotPath = path.join(outputRoot, "preview.png");
      await page.screenshot({ fullPage: true, path: screenshotPath });

      const referenceFolder = path.join(outputRoot, "reference");
      const screenshots: Array<{ path: string; width: number }> = [];
      let styles: HandoffReference["styles"] = {};
      let order: string[] = [];

      await mkdir(referenceFolder, { recursive: true });

      for (const width of HANDOFF_WIDTHS) {
        await page.setViewportSize({ width, height: HANDOFF_HEIGHT });
        const referencePath = path.join(referenceFolder, `${width}.png`);

        await page.screenshot({ animations: "disabled", caret: "hide", path: referencePath });
        screenshots.push({ path: referencePath, width });

        if (width === 1440) {
          const snapshot = await page.evaluate((properties) => {
            const elements = [
              ...document.querySelectorAll<HTMLElement>(
                "[data-fr-id]:not(style):not(script):not(link):not(meta)",
              ),
            ];
            const styleMap: Record<string, Record<string, string>> = {};

            for (const element of elements) {
              const id = element.dataset.frId;

              if (id === undefined) {
                continue;
              }

              const computed = getComputedStyle(element);

              styleMap[id] = Object.fromEntries(
                properties.map((property) => [property, computed.getPropertyValue(property)]),
              );
            }

            return {
              order: elements.flatMap((element) =>
                element.dataset.frId === undefined ? [] : [element.dataset.frId],
              ),
              styles: styleMap,
            };
          }, HANDOFF_STYLE_PROPERTIES);

          styles = snapshot.styles;
          order = snapshot.order;
        }
      }

      reference = { order, screenshots, styles };
    }
  } finally {
    await browser.close();
  }

  if (renderErrors.length > 0) {
    await close(server);

    return {
      errors: [],
      findings: [],
      previewUrl,
      reference,
      renderErrors,
      screenshotPath,
    };
  }

  try {
    const report = await runAutomatedChecks(previewUrl, {
      outputDir: path.join(outputRoot, "audit"),
    });

    return {
      errors: report.errors.map((error) => `${error.check} on ${error.selector}. ${error.message}`),
      findings: report.findings,
      previewUrl,
      reference,
      renderErrors,
      screenshotPath,
    };
  } catch (error) {
    return {
      errors: [error instanceof Error ? error.message : "The preview audit failed."],
      findings: [],
      previewUrl,
      reference,
      renderErrors,
      screenshotPath,
    };
  } finally {
    await close(server);
  }
}
