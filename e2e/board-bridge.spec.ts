import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

interface BoardSession {
  projectRoot: string;
  token: string;
  url: string;
}

interface BoardRequest {
  id: string;
  type: string;
  slot: number | null;
}

interface WaitPayload {
  timedOut: boolean;
  request?: BoardRequest;
  approval?: { slot: number; slug: string; round: number };
}

interface StatusPayload {
  board: { status: string };
  requests: BoardRequest[];
}

let session: BoardSession;
let client: Client;
let appServer: ReturnType<typeof createServer>;
let projectRoot: string;

function textContent(content: unknown): string {
  if (!Array.isArray(content)) {
    throw new Error("Tool result content is not an array.");
  }

  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
    ) {
      return item.text;
    }
  }

  throw new Error("Tool result did not include text content.");
}

function parseJson<T>(content: unknown): T {
  return JSON.parse(textContent(content)) as T;
}

async function callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const value = parseJson<T | { message?: string }>(result.content);

  if (result.isError === true) {
    throw new Error(
      "message" in (value as object) ? String((value as { message?: string }).message) : "Failed.",
    );
  }

  return value as T;
}

function variantSource(title: string): string {
  return `
export default function Variant() {
  return (
    <main data-fr-id="main" style={{ maxWidth: 420, margin: "0 auto", padding: 40, fontFamily: "system-ui, sans-serif" }}>
      <h1 data-fr-id="title">{${JSON.stringify(title)}}</h1>
      <p data-fr-id="body">Keep the important parts close.</p>
      <button data-fr-id="save" type="button" style={{ minHeight: 44, padding: "12px 18px" }}>Continue</button>
    </main>
  );
}
`;
}

test.beforeAll(async () => {
  const sessionPath = path.resolve("e2e", ".bridge-session.json");

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      session = JSON.parse(await readFile(sessionPath, "utf8")) as BoardSession;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  if (session === undefined) {
    throw new Error("The bridge board session did not appear.");
  }

  projectRoot = session.projectRoot;

  appServer = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative =
      pathname === "/"
        ? "index.html"
        : pathname.endsWith(".css")
          ? pathname.slice(1)
          : `${pathname.slice(1)}.html`;

    try {
      const body = await readFile(path.join(projectRoot, relative), "utf8");

      response.writeHead(200, {
        "content-type": relative.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/html; charset=utf-8",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolve) => {
    appServer.listen(4176, "127.0.0.1", resolve);
  });

  const transport = new StdioClientTransport({
    args: [path.resolve("packages/cli/dist/index.js"), "mcp"],
    command: process.execPath,
    cwd: projectRoot,
    env: {
      ...(process.env as Record<string, string>),
      FITTINGROOM_APP_URL: "http://127.0.0.1:4176",
      FITTINGROOM_CURRENT_PATH: "/login",
    },
    stderr: "pipe",
  });

  client = new Client({ name: "fittingroom-board-bridge-test", version: "0.0.0" });
  await client.connect(transport);
});

test.afterAll(async () => {
  await client.close();
  await new Promise<void>((resolve, reject) => {
    appServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test("moves a board request through variants and approval without a reload", async ({ page }) => {
  const opened = await callJson<{ started: boolean; url: string }>("fr_open_board", {});

  expect(opened.started).toBe(false);
  expect(opened.url).toBe(session.url);

  await page.goto(session.url);

  await expect(page.getByText("No directions yet.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate directions" }).click();
  await expect(page.getByText("Waiting for your agent.")).toBeVisible();

  const generated = await callJson<WaitPayload>("fr_wait_for_user", { timeoutSeconds: 5 });

  expect(generated.timedOut).toBe(false);
  expect(generated.request).toMatchObject({ type: "generate" });

  if (generated.request === undefined) {
    throw new Error("The generate request is missing.");
  }

  await callJson("fr_complete_request", { id: generated.request.id });
  await callJson("fr_audit", { scope: "auth" });
  await callJson("fr_directions", { route: "/login" });

  const variants = [
    { slug: "refined", title: "Refined login" },
    { slug: "clean-ui", title: "Clean login" },
    { slug: "dark-first", title: "Dark login" },
    { slug: "spatial", title: "Spatial login" },
  ];

  await mkdir(path.join(projectRoot, "variants"), { recursive: true });

  for (const variant of variants) {
    const filePath = path.join(projectRoot, "variants", `${variant.slug}.tsx`);

    await writeFile(filePath, variantSource(variant.title));
    const registered = await callJson<{ accepted: boolean }>("fr_register_variant", {
      filePath: `variants/${variant.slug}.tsx`,
      rationale: `${variant.title} keeps the content and improves the page.`,
      slug: variant.slug,
    });

    expect(registered.accepted).toBe(true);
  }

  await expect(page.getByTestId("variant-card")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Refined", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dark-First", exact: true })).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[data-variant-slug="refined"]')
      .getByRole("heading", { name: "Refined login" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Choose Refined" }).click();
  await page.getByRole("button", { name: "Approve selected direction" }).click();

  const approved = await callJson<WaitPayload>("fr_wait_for_user", { timeoutSeconds: 5 });

  expect(approved.timedOut).toBe(false);
  expect(approved.approval).toEqual({ slot: 1, slug: "refined", round: 1 });

  const status = await callJson<StatusPayload>("fr_board_status", {});

  expect(status.board.status).toBe("approved");
  expect(status.requests).toContainEqual(expect.objectContaining({ type: "approve", slot: 1 }));
});

test("edits a real variant file, then undo and redo return the exact file", async ({ page }) => {
  const variantPath = path.join(projectRoot, "variants", "refined.tsx");
  const origPath = path.join(projectRoot, ".fittingroom", "variants", "refined.orig.tsx");
  const logPath = path.join(projectRoot, ".fittingroom", "edits", "refined.json");
  const original = await readFile(variantPath, "utf8");

  await page.goto(session.url);

  const frame = page.frameLocator('iframe[data-variant-slug="refined"]');

  await frame.getByRole("heading", { name: "Refined login" }).click();

  const inspector = page.getByRole("complementary", { name: "Inspector" });

  await expect(inspector).toBeVisible();
  await inspector.getByLabel("Text content").fill("Refined welcome");

  const started = Date.now();

  await inspector.getByRole("button", { name: "Apply text" }).click();
  await expect(frame.getByRole("heading", { name: "Refined welcome" })).toBeVisible();

  const elapsed = Date.now() - started;
  const edited = await readFile(variantPath, "utf8");
  const log = JSON.parse(await readFile(logPath, "utf8")) as { edits: unknown[]; redo: unknown[] };

  expect(elapsed).toBeLessThan(2_000);
  expect(edited).toContain("Refined welcome");
  expect(await readFile(origPath, "utf8")).toBe(original);
  expect(log.edits).toHaveLength(1);
  expect(log.redo).toEqual([]);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(frame.getByRole("heading", { name: "Refined login" })).toBeVisible();
  expect(await readFile(variantPath, "utf8")).toBe(original);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(frame.getByRole("heading", { name: "Refined welcome" })).toBeVisible();
  expect(await readFile(variantPath, "utf8")).toBe(edited);
});

test("supports the editor keyboard shortcuts", async ({ page }) => {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.goto(session.url);

  const frame = page.frameLocator('iframe[data-variant-slug="refined"]');

  const inspector = page.getByRole("complementary", { name: "Inspector" });

  await frame.getByRole("heading", { name: "Refined welcome" }).click();
  await expect(inspector).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);

  await frame.getByRole("heading", { name: "Refined welcome" }).click();
  await expect(inspector).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(frame.getByRole("heading", { name: "Refined welcome" })).toHaveCount(0);

  await page.keyboard.press(`${modifier}+z`);
  await expect(frame.getByRole("heading", { name: "Refined welcome" })).toBeVisible();

  await page.keyboard.press(`${modifier}+Shift+z`);
  await expect(frame.getByRole("heading", { name: "Refined welcome" })).toHaveCount(0);
  await page.keyboard.press(`${modifier}+z`);
  await expect(frame.getByRole("heading", { name: "Refined welcome" })).toBeVisible();
});

interface RoundSnapshotPayload {
  id: string;
  slot: number;
  file: string;
  editLog: string | null;
  current: boolean;
  name: string;
}

interface RoundPayload {
  number: number;
  variants: RoundSnapshotPayload[];
}

interface RegeneratePayload {
  slots: Array<{ directionSlug: string | null; name: string; role: string; slot: number }>;
}

async function boardRounds(): Promise<RoundPayload[]> {
  const response = await fetch(
    `http://127.0.0.1:4175/api/rounds?token=${encodeURIComponent(session.token)}`,
  );

  return (await response.json()) as RoundPayload[];
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

test("restores code and edits from an earlier round, then restores the replaced variant", async ({
  page,
}) => {
  const variantPath = path.join(projectRoot, "variants", "refined.tsx");
  const logPath = path.join(projectRoot, ".fittingroom", "edits", "refined.json");

  for (const round of [2, 3]) {
    const regenerated = await callJson<RegeneratePayload>("fr_regenerate", {
      mode: "light",
      scope: "auth",
    });

    for (const slot of regenerated.slots) {
      const slug = slot.directionSlug ?? "refined";
      const filePath = path.join(projectRoot, "variants", `${slug}.tsx`);

      await writeFile(filePath, variantSource(`Round ${round} ${slot.name}`));
      const registered = await callJson<{ accepted: boolean }>("fr_register_variant", {
        filePath: `variants/${slug}.tsx`,
        rationale: `Round ${round} ${slot.name} keeps the content.`,
        slot: slot.slot,
        slug,
      });

      expect(registered.accepted).toBe(true);
    }
  }

  const roundsBefore = await boardRounds();
  const firstRound = roundsBefore.find((round) => round.number === 1);
  const firstRefined = firstRound?.variants.find(
    (snapshot) => snapshot.slot === 1 && snapshot.current,
  );

  expect(firstRound).toBeDefined();
  expect(firstRefined).toBeDefined();

  if (firstRound === undefined || firstRefined === undefined) {
    throw new Error("Round 1 did not save the refined variant.");
  }

  const firstRoundDirectory = path.join(projectRoot, ".fittingroom", "rounds", "1");
  const firstCode = await readFile(path.join(firstRoundDirectory, firstRefined.file), "utf8");
  const firstLog =
    firstRefined.editLog === null
      ? null
      : await readFile(path.join(firstRoundDirectory, firstRefined.editLog), "utf8");
  const replacedCode = await readFile(variantPath, "utf8");
  const replacedLog = await readTextIfPresent(logPath);

  await page.goto(session.url);
  await page.getByRole("button", { name: "Show previous rounds" }).click();
  await page.locator(`[data-snapshot-id="${firstRefined.id}"]`).click();

  const firstRestore = page.waitForResponse(
    (response) => response.url().includes("/api/restore") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await firstRestore;
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeDisabled();
  await expect.poll(async () => readFile(variantPath, "utf8")).toBe(firstCode);
  await expect.poll(async () => readTextIfPresent(logPath)).toBe(firstLog);

  const roundsAfter = await boardRounds();
  const currentRound = roundsAfter.find((round) => round.number === 3);

  expect(currentRound).toBeDefined();

  if (currentRound === undefined) {
    throw new Error("Round 3 was not found.");
  }

  let replaced: RoundSnapshotPayload | undefined;

  for (const snapshot of currentRound.variants) {
    if (snapshot.id === firstRefined.id || snapshot.current) {
      continue;
    }

    const code = await readFile(
      path.join(projectRoot, ".fittingroom", "rounds", "3", snapshot.file),
      "utf8",
    );

    if (code === replacedCode) {
      replaced = snapshot;
      break;
    }
  }

  expect(replaced).toBeDefined();

  if (replaced === undefined) {
    throw new Error("The replaced variant was not saved in round 3.");
  }

  await page.locator(`[data-snapshot-id="${replaced.id}"]`).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeEnabled();

  const secondRestore = page.waitForResponse(
    (response) => response.url().includes("/api/restore") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await secondRestore;
  await expect.poll(async () => readFile(variantPath, "utf8")).toBe(replacedCode);
  await expect.poll(async () => readTextIfPresent(logPath)).toBe(replacedLog);
});
