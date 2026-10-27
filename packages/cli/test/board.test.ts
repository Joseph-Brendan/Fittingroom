import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBoardCommand } from "../src/board-command";

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-board-"));
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

function captureOutput(): { output: NodeJS.WritableStream; text: () => string } {
  let text = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });

  return { output, text: () => text };
}

async function writeConnectedProject(): Promise<string> {
  const projectRoot = path.join(temporaryDirectory, "connected-app");

  await mkdir(path.join(projectRoot, "app"), { recursive: true });
  await mkdir(path.join(projectRoot, "components", "ui"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "app", "page.tsx"),
    "export default function Page() {\n  return <main>Home</main>;\n}\n",
  );
  await writeFile(
    path.join(projectRoot, "app", "globals.css"),
    [
      '@import "tailwindcss";',
      "@theme {",
      "  --color-brand: #0f766e;",
      "  --spacing-sm: 8px;",
      "  --radius-card: 12px;",
      "  --font-sans: system-ui, sans-serif;",
      "  --text-sm: 14px;",
      "  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.12);",
      "}",
      ":root {",
      "  --background: #ffffff;",
      "  --foreground: #111111;",
      "  --primary: #0f766e;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectRoot, "components.json"),
    `${JSON.stringify({ style: "new-york", tailwind: { css: "app/globals.css" } }, null, 2)}\n`,
  );
  await writeFile(
    path.join(projectRoot, "components", "ui", "button.tsx"),
    'export function Button() {\n  return <button type="button">Go</button>;\n}\n',
  );

  return projectRoot;
}

describe("fitroom board", () => {
  it("keeps the connected design system after a board request", async () => {
    const projectRoot = await writeConnectedProject();
    const previousDirectory = process.cwd();
    let server: Awaited<ReturnType<typeof runBoardCommand>> | undefined;

    process.chdir(projectRoot);

    try {
      server = await runBoardCommand({ port: 0 });

      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/request?token=${server.token}`,
        {
          body: JSON.stringify({ type: "generate" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const state = (await response.json()) as {
        designSystem?: { status?: string };
        status: string;
      };

      expect(response.ok).toBe(true);
      expect(state.status).toBe("generating");
      expect(state.designSystem).toMatchObject({ status: "connected" });
    } finally {
      await server?.close();
      process.chdir(previousDirectory);
    }
  }, 120_000);

  it("reuses a live board and prints its URL", async () => {
    const projectRoot = await writeConnectedProject();
    const previousDirectory = process.cwd();
    const firstOutput = captureOutput();
    const secondOutput = captureOutput();
    let first: Awaited<ReturnType<typeof runBoardCommand>> | undefined;
    let second: Awaited<ReturnType<typeof runBoardCommand>> | undefined;

    process.chdir(projectRoot);

    try {
      first = await runBoardCommand({ output: firstOutput.output, port: 0 });
      second = await runBoardCommand({ output: secondOutput.output, port: 0 });

      expect(second.reused).toBe(true);
      expect(second.url).toBe(first.url);
      expect(second.port).toBe(first.port);
      expect(second.token).toBe(first.token);
      expect(secondOutput.text()).toContain(`Board ready: ${first.url}`);

      await second.close();

      const response = await fetch(first.url);

      expect(response.ok).toBe(true);
    } finally {
      await second?.close();
      await first?.close();
      process.chdir(previousDirectory);
    }
  }, 120_000);

  it("shows a connected design system for a connected app", async () => {
    const projectRoot = await writeConnectedProject();
    const previousDirectory = process.cwd();
    let server: Awaited<ReturnType<typeof runBoardCommand>> | undefined;

    process.chdir(projectRoot);

    try {
      server = await runBoardCommand({ port: 0 });

      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/board?token=${server.token}`,
      );
      const state = (await response.json()) as {
        designSystem?: { status?: string; summary?: string };
      };

      expect(state.designSystem).toMatchObject({ status: "connected" });
      expect(state.designSystem?.summary).toContain("Design system connected");
    } finally {
      await server?.close();
      process.chdir(previousDirectory);
    }
  }, 120_000);
});
