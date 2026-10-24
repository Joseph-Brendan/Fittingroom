import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium, expect } from "@playwright/test";

const appRoot = "/Users/josephbrendan/Documents/fr-test-apps/metrics-dashboard";
const screenshotRoot =
  "/Users/josephbrendan/Documents/fittingroom/test-reports/run-2/screenshots/round-4";
const logRoot = "/Users/josephbrendan/Documents/fittingroom/test-reports/run-2/logs/round-4";
const result = { app: "metrics-dashboard", steps: {} };

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
  env: { ...process.env, FITTINGROOM_CURRENT_PATH: "/dashboard" },
  stderr: "pipe",
});
const client = new Client({ name: "metrics-loop", version: "0.0.0" });
let boardPid;
let browser;

try {
  await client.connect(transport);
  result.steps.scopes = await call("fr_scopes");
  await saveJson("metrics-scopes", result.steps.scopes);

  const board = await call("fr_open_board");
  boardPid = board.pid;
  result.steps.board = board;
  await saveJson("metrics-board-open", board);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(board.url);

  await page.getByRole("button", { name: "Generate directions" }).click();
  await expect(page.getByText("Waiting for your agent.")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotRoot, "metrics-board-request.png"),
    fullPage: true,
  });

  const generate = await call("fr_wait_for_user", { timeoutSeconds: 15 });
  result.steps.generateRequest = generate;
  await saveJson("metrics-generate-request", generate);
  if (generate.timedOut || generate.request === undefined) throw new Error("No generate request.");
  await call("fr_complete_request", { id: generate.request.id });

  const audit = await call("fr_audit", { scope: "dashboard" });
  result.steps.audit = audit;
  await saveJson("metrics-audit-dashboard", audit);

  const judged = await call("fr_submit_findings", {
    findings: [
      {
        citation: "nielsen-h1",
        confidence: "judged",
        evidence: {
          measuredValue: "No last updated time is visible on the dashboard.",
          screenshotPath: audit.screenshots[0],
          selector: "main",
        },
        fix: "Add a last updated line near the page title.",
        id: "metrics-judged-last-updated",
        severity: 2,
        title: "Dashboard does not show when the data was last updated",
      },
    ],
  });
  result.steps.judged = judged;
  await saveJson("metrics-judged", judged);

  const directions = await call("fr_directions", { route: "/dashboard" });
  result.steps.directions = directions;
  await saveJson("metrics-directions", directions);

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
      rationale: `${entry.slug} keeps the dashboard content and improves the page.`,
      slot: entry.slot,
      slug: entry.slug,
    });

    result.steps.registered.push(registered);

    if (!registered.accepted) {
      throw new Error(`Variant ${entry.slug} was rejected: ${JSON.stringify(registered.errors)}`);
    }
  }

  await expect(page.locator("article.variant-card")).toHaveCount(4);
  await page.screenshot({
    path: path.join(screenshotRoot, "metrics-board-cards.png"),
    fullPage: true,
  });

  const frame = page.frameLocator('iframe[data-variant-slug="refined"]');
  await frame.getByRole("heading", { name: "Dashboard" }).click();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector).toBeVisible();
  await inspector.screenshot({
    path: path.join(screenshotRoot, "metrics-inspector.png"),
  });

  await inspector.getByLabel("Text content").fill("Team dashboard");
  await inspector.getByRole("button", { name: "Apply text" }).click();
  await expect(frame.getByRole("heading", { name: "Team dashboard" })).toBeVisible();

  const type = inspector.getByLabel("Type");
  await type.selectOption("custom");
  await inspector.getByLabel("Custom type").fill("44px");
  await inspector.getByRole("button", { name: "Apply custom value" }).click();
  await expect(frame.getByRole("heading", { name: "Team dashboard" })).toHaveCSS(
    "font-size",
    "44px",
  );
  await page.screenshot({
    path: path.join(screenshotRoot, "metrics-edits.png"),
    fullPage: true,
  });

  const structurePanel = page.getByRole("region", { name: "Information design" });
  await expect(structurePanel).toBeVisible();
  await structurePanel.getByLabel("Density").selectOption("dense");
  await page.waitForTimeout(750);
  await page.screenshot({
    path: path.join(screenshotRoot, "metrics-structure-density.png"),
    fullPage: true,
  });
  await saveJson(
    "metrics-structure",
    JSON.parse(await readFile(path.join(appRoot, ".fittingroom", "structure.json"), "utf8")),
  );

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Choose Refined" }).click();
  await page.getByRole("button", { name: "Approve selected direction" }).click();
  const approval = await call("fr_wait_for_user", { timeoutSeconds: 15 });
  result.steps.approval = approval;
  await saveJson("metrics-approval", approval);
  if (approval.approval === undefined) throw new Error("The board did not approve a variant.");
  await page.screenshot({
    path: path.join(screenshotRoot, "metrics-board-approved.png"),
    fullPage: true,
  });

  const status = await call("fr_board_status");
  for (const request of status.requests) {
    await call("fr_complete_request", { id: request.id });
  }

  const handoff = await call("fr_handoff", { variantSlug: "refined" });
  result.steps.handoff = handoff;
  await saveJson("metrics-handoff", handoff);

  await page.goto("http://127.0.0.1:3200/dashboard", { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(screenshotRoot, "metrics-real-dashboard-after.png"),
    fullPage: true,
  });

  const verify = await call("fr_verify", { handoffId: handoff.handoffId, route: "/dashboard" });
  result.steps.verify = verify;
  await saveJson("metrics-verify", verify);
  if (!verify.passed) throw new Error("The real dashboard did not match the handoff.");

  const variantPath = path.join(appRoot, "variants", "refined.tsx");
  const backup = await readFile(variantPath, "utf8");
  try {
    await writeFile(variantPath, backup.replace("Team dashboard", "Wrong build heading"));
    await page.goto("http://127.0.0.1:3200/dashboard", { waitUntil: "networkidle" });
    await page.screenshot({
      path: path.join(screenshotRoot, "metrics-real-dashboard-wrong.png"),
      fullPage: true,
    });
    const wrong = await call("fr_verify", { handoffId: handoff.handoffId, route: "/dashboard" });
    result.steps.verifyWrong = wrong;
    await saveJson("metrics-verify-wrong", wrong);
    if (wrong.passed) throw new Error("Verify passed on the wrong build.");
  } finally {
    await writeFile(variantPath, backup);
    await page.goto("http://127.0.0.1:3200/dashboard", { waitUntil: "networkidle" });
  }

  const memoryAudit = await call("fr_audit", { scope: "dashboard" });
  result.steps.memoryAudit = memoryAudit;
  result.steps.designMemoryFindings = memoryAudit.findings.filter(
    (finding) => finding.citation === "project-design-memory",
  );
  await saveJson("metrics-design-memory-audit", memoryAudit);

  const states = await call("fr_states", { route: "/dashboard" });
  result.steps.states = states;
  await saveJson("metrics-states", states);
  for (const file of await readdir(path.join(appRoot, ".fittingroom", "states"))) {
    if (file.endsWith(".png") || file.endsWith(".json")) {
      const source = path.join(appRoot, ".fittingroom", "states", file);
      const target = path.join(screenshotRoot, `metrics-states-${file}`);

      await cp(source, target);
    }
  }

  await saveJson("metrics-loop-summary", result);
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
