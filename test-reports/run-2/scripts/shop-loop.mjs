import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium, expect } from "@playwright/test";

const appRoot = "/Users/josephbrendan/Documents/fr-test-apps/shop-app";
const screenshotRoot =
  "/Users/josephbrendan/Documents/fittingroom/test-reports/run-2/screenshots/round-4";
const logRoot = "/Users/josephbrendan/Documents/fittingroom/test-reports/run-2/logs/round-4";
const result = { app: "shop-app", steps: {} };

function parse(content) {
  for (const item of content ?? []) {
    if (item && typeof item === "object" && item.type === "text" && typeof item.text === "string") {
      return JSON.parse(item.text);
    }
  }

  throw new Error("No JSON content in tool result.");
}

async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });

  if (response.isError === true) {
    throw new Error(`${name}: ${parse(response.content).message ?? "Tool failed."}`);
  }

  return parse(response.content);
}

async function saveJson(name, value) {
  await writeFile(path.join(logRoot, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

const transport = new StdioClientTransport({
  command: "fitroom",
  args: ["mcp"],
  cwd: appRoot,
  env: { ...process.env, FITTINGROOM_CURRENT_PATH: "/login" },
  stderr: "pipe",
});
const client = new Client({ name: "shop-loop", version: "0.0.0" });
let boardPid;
let browser;

try {
  await client.connect(transport);
  result.steps.scopes = await call("fr_scopes");
  await saveJson("shop-scopes", result.steps.scopes);

  const board = await call("fr_open_board");
  boardPid = board.pid;
  result.steps.board = board;
  await saveJson("shop-board-open", board);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(board.url);

  await page.getByRole("button", { name: "Generate directions" }).click();
  await expect(page.getByText("Waiting for your agent.")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotRoot, "shop-board-request.png"),
    fullPage: true,
  });

  const generate = await call("fr_wait_for_user", { timeoutSeconds: 15 });
  result.steps.generateRequest = generate;
  await saveJson("shop-generate-request", generate);
  if (generate.timedOut || generate.request === undefined) throw new Error("No generate request.");
  await call("fr_complete_request", { id: generate.request.id });

  const audit = await call("fr_audit", { scope: "auth" });
  result.steps.audit = audit;
  await saveJson("shop-audit-auth", audit);

  const judged = await call("fr_submit_findings", {
    findings: [
      {
        citation: "nielsen-h9",
        confidence: "judged",
        evidence: {
          measuredValue: "The login form has no visible recovery path for a forgotten password.",
          screenshotPath: audit.screenshots[0],
          selector: "main section form",
        },
        fix: "Add a Forgot password link below the password field.",
        id: "shop-judged-password-recovery",
        severity: 2,
        title: "Login has no recovery path",
      },
    ],
  });
  result.steps.judged = judged;
  await saveJson("shop-judged", judged);

  const directions = await call("fr_directions", { route: "/login" });
  result.steps.directions = directions;
  await saveJson("shop-directions", directions);

  const files = [
    { slot: 1, slug: "refined", filePath: "variants/refined.tsx" },
    { slot: 2, slug: "native", filePath: "variants/native.tsx" },
    { slot: 3, slug: "bold", filePath: "variants/bold.tsx" },
    { slot: 4, slug: "wildcard", filePath: "variants/wildcard.tsx" },
  ];
  result.steps.registered = [];

  for (const entry of files) {
    const registered = await call("fr_register_variant", {
      filePath: entry.filePath,
      rationale: `${entry.slug} keeps the login content and improves the page.`,
      slot: entry.slot,
      slug: entry.slug,
    });

    result.steps.registered.push(registered);
    if (!registered.accepted) {
      throw new Error(`Variant ${entry.slug} was rejected: ${JSON.stringify(registered.errors)}`);
    }
  }

  await expect(page.locator("article.variant-card")).toHaveCount(4);
  await expect(page.getByText("Design system connected", { exact: false })).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotRoot, "shop-board-cards.png"),
    fullPage: true,
  });
  await page
    .getByText("Design system connected", { exact: false })
    .screenshot({ path: path.join(screenshotRoot, "shop-banner-connected.png") });

  const frame = page.frameLocator('iframe[data-variant-slug="refined"]');
  await frame.getByRole("heading", { name: "Welcome back" }).click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeVisible();
  await inspector.screenshot({ path: path.join(screenshotRoot, "shop-inspector-tokens.png") });

  const color = inspector.getByLabel("Color");
  const tokenOptions = await color.locator("option").allTextContents();
  result.steps.tokenOptions = tokenOptions;
  await saveJson("shop-token-options", tokenOptions);
  await color.selectOption("custom");
  await inspector.getByLabel("Custom color").fill("#ff00ff");
  await inspector.getByRole("button", { name: "Apply custom value" }).click();
  await expect(frame.getByRole("heading", { name: "Welcome back" })).toHaveCSS(
    "color",
    "rgb(255, 0, 255)",
  );
  await page.screenshot({
    path: path.join(screenshotRoot, "shop-offsystem-color.png"),
    fullPage: true,
  });

  const editLog = JSON.parse(
    await readFile(path.join(appRoot, ".fittingroom", "edits", "refined.json"), "utf8"),
  );
  result.steps.offSystem = editLog.edits.at(-1)?.offSystem;
  await saveJson("shop-edit-log-after-color", editLog);
  if (result.steps.offSystem !== true)
    throw new Error("The custom color was not marked off system.");

  await inspector.getByLabel("Text content").fill("Welcome back to Northwind");
  await inspector.getByRole("button", { name: "Apply text" }).click();
  await expect(frame.getByRole("heading", { name: "Welcome back to Northwind" })).toBeVisible();

  const structurePanel = page.getByRole("region", { name: "Information design" });
  await expect(structurePanel).toBeVisible();
  await structurePanel.getByLabel("Density").selectOption("sparse");
  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(screenshotRoot, "shop-structure-density.png"),
    fullPage: true,
  });
  await saveJson(
    "shop-structure",
    JSON.parse(await readFile(path.join(appRoot, ".fittingroom", "structure.json"), "utf8")),
  );

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Choose Refined" }).click();
  await page.getByRole("button", { name: "Approve selected direction" }).click();
  const approval = await call("fr_wait_for_user", { timeoutSeconds: 15 });
  result.steps.approval = approval;
  await saveJson("shop-approval", approval);
  if (approval.approval === undefined) throw new Error("The board did not approve a variant.");
  await page.screenshot({
    path: path.join(screenshotRoot, "shop-board-approved.png"),
    fullPage: true,
  });

  const status = await call("fr_board_status");
  for (const request of status.requests) {
    await call("fr_complete_request", { id: request.id });
  }

  const handoff = await call("fr_handoff", { variantSlug: "refined" });
  result.steps.handoff = handoff;
  await saveJson("shop-handoff", handoff);

  await page.goto("http://127.0.0.1:3100/login", { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(screenshotRoot, "shop-real-login-after.png"),
    fullPage: true,
  });

  const verify = await call("fr_verify", { handoffId: handoff.handoffId, route: "/login" });
  result.steps.verify = verify;
  await saveJson("shop-verify", verify);
  if (!verify.passed) throw new Error("The real login page did not match the handoff.");

  const variantPath = path.join(appRoot, "variants", "refined.tsx");
  const backup = await readFile(variantPath, "utf8");
  try {
    await writeFile(
      variantPath,
      backup
        .replace("Welcome back to Northwind", "Wrong build heading")
        .replace("#ff00ff", "#00ff00"),
    );
    await page.goto("http://127.0.0.1:3100/login", { waitUntil: "networkidle" });
    await page.screenshot({
      path: path.join(screenshotRoot, "shop-real-login-wrong.png"),
      fullPage: true,
    });
    const wrong = await call("fr_verify", { handoffId: handoff.handoffId, route: "/login" });
    result.steps.verifyWrong = wrong;
    await saveJson("shop-verify-wrong", wrong);
    if (wrong.passed) throw new Error("Verify passed on the wrong build.");
  } finally {
    await writeFile(variantPath, backup);
    await page.goto("http://127.0.0.1:3100/login", { waitUntil: "networkidle" });
  }

  await saveJson("shop-loop-summary", result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser !== undefined) await browser.close();
  await client.close().catch(() => {});

  if (boardPid !== undefined) {
    try {
      process.kill(boardPid, "SIGTERM");
    } catch {}
  }
}
