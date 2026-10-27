import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";

const require = createRequire(path.join(process.cwd(), "package.json"));
const axePath = require.resolve("axe-core/axe.min.js", {
  paths: [path.resolve("packages/core")],
});
const widths = [375, 768, 1280, 1440] as const;
const themes = ["light", "dark"] as const;
const overflowWidths = Array.from({ length: 21 }, (_, index) => 320 + index * 80);
const panelWidths = [375, 768, 1024, 1280, 1440] as const;
const states = [
  "empty",
  "waiting",
  "cards",
  "selected",
  "editor",
  "structure",
  "findings",
  "previous",
  "toast",
  "approved",
  "connected",
] as const;

type Theme = (typeof themes)[number];
type StateName = (typeof states)[number];

interface BoardSession {
  token: string;
  url: string;
}

interface AxeRunResult {
  violations: Array<{ help: string; id: string }>;
}

let normalSession: BoardSession;
let approvedSession: BoardSession;
let emptySession: BoardSession;
let waitingSession: BoardSession;

test.describe.configure({ mode: "serial", timeout: 600_000 });

async function readSession(fileName: string): Promise<BoardSession> {
  const sessionPath = path.resolve("e2e", fileName);

  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return JSON.parse(await readFile(sessionPath, "utf8")) as BoardSession;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(`${fileName} did not appear.`);
}

test.beforeAll(async () => {
  [normalSession, approvedSession, emptySession, waitingSession] = await Promise.all([
    readSession(".ui-board-session.json"),
    readSession(".ui-board-approved-session.json"),
    readSession(".ui-board-empty-session.json"),
    readSession(".ui-board-waiting-session.json"),
  ]);
});

function sessionFor(state: StateName): BoardSession {
  if (state === "empty") return emptySession;
  if (state === "waiting") return waitingSession;
  if (state === "approved") return approvedSession;
  return normalSession;
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
  });
  await page.waitForTimeout(250);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

async function openPanel(page: Page): Promise<void> {
  const panel = page.getByTestId("board-panel");

  if (!(await panel.isVisible())) {
    await page.getByTestId("panel-toggle").click();
  }
}

async function prepareState(page: Page, state: StateName, theme: Theme): Promise<void> {
  const session = sessionFor(state);

  await page.emulateMedia({ colorScheme: theme });
  await page.goto(session.url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Fitting Room", level: 1 }).waitFor();
  await waitForFonts(page);

  if (state === "waiting") {
    await page.getByRole("button", { name: "Generate directions" }).click();
    await page.getByText("Waiting for your agent.", { exact: true }).waitFor();
    await page
      .getByText("Ask your agent: Generate 4 design directions for Marketing.", {
        exact: true,
      })
      .waitFor();
    await settle(page);
    return;
  }

  if (state === "empty") {
    await page.getByText("No directions yet.", { exact: true }).waitFor();
    await settle(page);
    return;
  }

  await expect(page.getByTestId("variant-card")).toHaveCount(4);

  if (state === "cards") {
    await settle(page);
    return;
  }

  if (state === "connected") {
    await page.getByText("Design system connected:", { exact: false }).waitFor();
    await settle(page);
    return;
  }

  if (state === "approved") {
    await page.getByText("Approved: Refined.", { exact: true }).waitFor();
    await settle(page);
    return;
  }

  if (state === "selected") {
    await page.getByRole("button", { name: "Choose Refined" }).click();
    await settle(page);
    return;
  }

  if (state === "editor") {
    await page
      .frameLocator('iframe[data-variant-slug="refined"]')
      .getByRole("heading", { name: "Refined preview" })
      .click();
    await page.getByRole("complementary", { name: "Inspector" }).waitFor();
    await settle(page);
    return;
  }

  if (state === "structure") {
    await openPanel(page);
    await page.getByRole("tab", { name: "Structure" }).click();
    await page.getByRole("region", { name: "Information design" }).waitFor();
    await settle(page);
    return;
  }

  if (state === "findings") {
    const findingsButton = page.getByRole("button", { name: "Findings (3)" });

    if (await findingsButton.isVisible()) {
      await findingsButton.click();
    } else {
      await openPanel(page);
      await page.getByRole("tab", { name: /Findings/ }).click();
    }

    await page.getByRole("complementary", { name: "Findings drawer" }).waitFor();
    await settle(page);
    return;
  }

  if (state === "previous") {
    await page.getByRole("button", { name: "Show previous rounds" }).click();
    await page.getByText("Round 1", { exact: false }).first().waitFor();
    await settle(page);
    return;
  }

  if (state === "toast") {
    await page.getByText("Live sync connected.").waitFor();
    await page.getByLabel("Try another direction").fill("Make it feel like a Lagos record shop");
    await page.getByRole("button", { name: "Send request" }).click();
    await page
      .getByText("Request sent. The agent will pick a new direction.", { exact: true })
      .waitFor();
    await settle(page);
  }
}

async function checkNoOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const violations: Array<Record<string, unknown>> = [];
    const elements = [...document.querySelectorAll<HTMLElement>("body *")];

    for (const element of elements) {
      if (
        element.tagName === "SCRIPT" ||
        element.tagName === "STYLE" ||
        element.classList.contains("sr-only")
      ) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        continue;
      }

      const overflowX = element.scrollWidth > element.clientWidth + 1;
      const overflowY = element.scrollHeight > element.clientHeight + 1;

      if (!overflowX && !overflowY) {
        continue;
      }

      const scrollX = style.overflowX === "auto" || style.overflowX === "scroll";
      const scrollY = style.overflowY === "auto" || style.overflowY === "scroll";
      const ellipsis = style.textOverflow === "ellipsis" && style.overflowX === "hidden";
      const clamped =
        style.webkitLineClamp !== "" &&
        style.webkitLineClamp !== "none" &&
        style.overflowY === "hidden";
      const previewClip = element.dataset.previewClip === "true";

      if (
        (overflowX && !scrollX && !ellipsis && !previewClip) ||
        (overflowY && !scrollY && !clamped && !previewClip)
      ) {
        violations.push({
          id: element.id,
          testId: element.dataset.testid ?? null,
          tag: element.tagName,
          className: element.className,
          overflowX,
          overflowY,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        });
      }
    }

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      violations,
    };
  });

  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.violations).toEqual([]);
}

async function checkFlatStyles(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const found: Array<Record<string, unknown>> = [];

    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(element);
      const tag = element.tagName;

      if (style.boxShadow !== "none") {
        found.push({ property: "box-shadow", value: style.boxShadow, tag });
      }

      if (tag !== "IMG" && style.backgroundImage !== "none") {
        found.push({ property: "background-image", value: style.backgroundImage, tag });
      }

      if (style.textShadow !== "none") {
        found.push({ property: "text-shadow", value: style.textShadow, tag });
      }

      if (style.backdropFilter !== "none") {
        found.push({ property: "backdrop-filter", value: style.backdropFilter, tag });
      }

      if (style.filter !== "none") {
        found.push({ property: "filter", value: style.filter, tag });
      }
    }

    return found;
  });

  expect(violations).toEqual([]);
}

async function runAxe(page: Page): Promise<AxeRunResult> {
  await page.addScriptTag({ path: axePath });

  return page.evaluate(async () => {
    const runner = (
      window as Window & {
        axe?: {
          run: (
            context: Document,
            options: {
              iframes: boolean;
              runOnly: { type: "tag"; values: string[] };
            },
          ) => Promise<AxeRunResult>;
        };
      }
    ).axe;

    if (runner === undefined) {
      throw new Error("axe-core did not load.");
    }

    return runner.run(document, {
      iframes: false,
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
  });
}

async function checkTouchTargets(page: Page): Promise<void> {
  const violations = await page.evaluate(() => {
    const found: Array<Record<string, unknown>> = [];
    const selector = [
      "button",
      "a[href]",
      "input",
      "select",
      "textarea",
      '[role="tab"]',
      '[role="button"]',
      "[data-testid='variant-card']",
    ].join(",");

    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        continue;
      }

      if (rect.width < 43.5 || rect.height < 43.5) {
        found.push({
          height: rect.height,
          label:
            element.getAttribute("aria-label") ??
            element.textContent?.trim().slice(0, 40) ??
            element.tagName,
          tag: element.tagName,
          width: rect.width,
        });
      }
    }

    return found;
  });

  expect(violations).toEqual([]);
}

async function newPage(browser: Browser, width: number, theme: Theme): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.emulateMedia({ colorScheme: theme });
  return page;
}

for (const theme of themes) {
  test(`captures every state at four widths in ${theme}`, async ({ browser }) => {
    for (const state of states) {
      for (const width of widths) {
        const page = await newPage(browser, width, theme);

        try {
          await prepareState(page, state, theme);

          if (state !== "empty" && state !== "waiting") {
            await waitForFonts(page);
          }

          const fullPage =
            !["editor", "structure", "findings", "toast"].includes(state) || width >= 1280;

          await expect(page).toHaveScreenshot(`${state}-${theme}-${width}.png`, {
            fullPage,
          });
        } finally {
          await page.close();
        }
      }
    }
  });
}

test("has no horizontal page overflow from 320 to 1920 pixels", async ({ browser }) => {
  for (const state of ["empty", "waiting", "cards"] as const) {
    const page = await newPage(browser, 1440, "light");

    try {
      await prepareState(page, state, "light");

      for (const width of overflowWidths) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(60);
        await checkNoOverflow(page);
      }
    } finally {
      await page.close();
    }
  }

  for (const state of [
    "selected",
    "editor",
    "structure",
    "findings",
    "previous",
    "toast",
    "approved",
    "connected",
  ] as const) {
    for (const width of panelWidths) {
      const page = await newPage(browser, width, "light");

      try {
        await prepareState(page, state, "light");
        await checkNoOverflow(page);
      } finally {
        await page.close();
      }
    }
  }
});

for (const theme of themes) {
  test(`uses no shadows, gradients or blur in ${theme}`, async ({ browser }) => {
    for (const state of states) {
      const page = await newPage(browser, 1280, theme);

      try {
        await prepareState(page, state, theme);
        await checkFlatStyles(page);
      } finally {
        await page.close();
      }
    }
  });
}

for (const theme of themes) {
  test(`has no axe violations in ${theme}`, async ({ browser }) => {
    for (const state of states) {
      const page = await newPage(browser, 1280, theme);

      try {
        await prepareState(page, state, theme);
        const result = await runAxe(page);
        const details = result.violations.map((violation) => `${violation.id}: ${violation.help}`);

        expect(result.violations, details.join("\n")).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });
}

test("supports keyboard card navigation and focus rings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await prepareState(page, "cards", "light");

  const cards = page.getByTestId("variant-card");
  const firstChoose = page.getByRole("button", { name: "Choose Refined" });

  await firstChoose.focus();
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement && getComputedStyle(active).outlineStyle !== "none";
    }),
  ).toBe(true);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Choose Clean UI" })).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Choose Spatial" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(cards.nth(3)).toHaveAttribute("data-chosen", "true");

  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const active = document.activeElement;

      if (!(active instanceof HTMLElement)) {
        return { visible: true, tag: "none" };
      }

      if (active === document.body || active === document.documentElement) {
        return { visible: true, tag: active.tagName };
      }

      const style = getComputedStyle(active);
      return {
        className: active.className,
        label: active.getAttribute("aria-label"),
        outlineStyle: style.outlineStyle,
        tag: active.tagName,
        visible: style.outlineStyle !== "none" || style.boxShadow !== "none",
      };
    });

    expect(focus.visible, JSON.stringify(focus)).toBe(true);
  }
});

test("closes panels and dialogs with Escape and returns focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await prepareState(page, "cards", "light");

  const findingsButton = page.getByRole("button", { name: "Findings (3)" });

  await findingsButton.click();
  await expect(page.getByRole("complementary", { name: "Findings drawer" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Findings drawer" })).toHaveCount(0);
  await expect(findingsButton).toBeFocused();

  const openFullSize = page.getByRole("button", { name: "Open full size Refined" });

  await openFullSize.click();
  await expect(page.getByRole("dialog", { name: "Refined full size preview" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Refined full size preview" })).toHaveCount(0);
  await expect(openFullSize).toBeFocused();
});

test("uses a bottom sheet on a phone and closes it with Escape", async ({ browser }) => {
  const page = await newPage(browser, 375, "light");

  try {
    await prepareState(page, "cards", "light");

    const toggle = page.getByTestId("panel-toggle");

    await expect(toggle).toBeVisible();
    await toggle.click();
    const sheet = page.getByTestId("board-panel");

    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();

    expect(box?.height).toBeGreaterThan(700);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(toggle).toBeFocused();
  } finally {
    await page.close();
  }
});

test("keeps every control at least 44 by 44 on a phone", async ({ browser }) => {
  for (const state of ["cards", "editor", "structure", "findings", "previous", "toast"] as const) {
    const page = await newPage(browser, 375, "light");

    try {
      await prepareState(page, state, "light");
      await checkTouchTargets(page);
    } finally {
      await page.close();
    }
  }
});

test("lays out the shell for desktop, tablet and phone", async ({ browser }) => {
  const desktop = await newPage(browser, 1280, "light");

  try {
    await prepareState(desktop, "cards", "light");
    await expect(desktop.getByTestId("board-panel")).toBeVisible();

    const desktopLayout = await desktop.evaluate(() => ({
      columns: getComputedStyle(
        document.querySelector('[data-testid="variant-grid"]') as HTMLElement,
      ).gridTemplateColumns.split(" ").length,
      panelWidth: (
        document.querySelector('[data-testid="board-panel"]') as HTMLElement
      ).getBoundingClientRect().width,
      topBarHeight: (
        document.querySelector('[data-testid="top-bar"]') as HTMLElement
      ).getBoundingClientRect().height,
    }));

    expect(desktopLayout.columns).toBe(2);
    expect(desktopLayout.panelWidth).toBeCloseTo(360, 0);
    expect(desktopLayout.topBarHeight).toBeCloseTo(56, 0);
  } finally {
    await desktop.close();
  }

  const tablet = await newPage(browser, 1024, "light");

  try {
    await prepareState(tablet, "cards", "light");
    await expect(tablet.getByTestId("board-panel")).toHaveCount(0);
    await tablet.getByTestId("panel-toggle").click();
    await expect(tablet.getByTestId("board-panel")).toBeVisible();
    expect(
      await tablet.evaluate(
        () =>
          (
            document.querySelector('[data-testid="board-panel"]') as HTMLElement
          ).getBoundingClientRect().width,
      ),
    ).toBeCloseTo(400, 0);
  } finally {
    await tablet.close();
  }

  const phone = await newPage(browser, 375, "light");

  try {
    await prepareState(phone, "cards", "light");
    await expect(phone.getByLabel("Preview viewport")).toBeVisible();
    await expect(phone.getByRole("button", { name: "Approve selected direction" })).toBeVisible();

    const columns = await phone.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-testid="variant-grid"]') as HTMLElement,
        ).gridTemplateColumns.split(" ").length,
    );

    expect(columns).toBe(1);
  } finally {
    await phone.close();
  }
});

test("shows selected, pinned and refined card states", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await prepareState(page, "selected", "light");

  const refined = page.getByTestId("variant-card").first();
  const selectedStyle = await refined.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
    };
  });

  expect(selectedStyle.borderWidth).toBe("2px");
  await expect(refined.getByText("Selected", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("variant-card").nth(1).getByText("Pinned", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Unpin Clean UI" })).toBeVisible();
  await expect(page.getByText("Your design, refined.", { exact: true })).toBeVisible();

  const rationale = page.getByTestId("card-rationale").first();

  expect(await rationale.getAttribute("title")).toBeTruthy();
  expect(
    await rationale.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.webkitLineClamp;
    }),
  ).toBe("2");

  const preview = page.getByTestId("preview-window").first();
  const previewBox = await preview.boundingBox();
  const iframeBox = await page.locator("iframe").first().boundingBox();

  expect(previewBox).not.toBeNull();
  expect(iframeBox).not.toBeNull();
  expect((iframeBox?.width ?? Infinity) <= (previewBox?.width ?? 0) + 1).toBe(true);
  await expect(page.getByRole("button", { name: "Open full size Refined" })).toBeVisible();
});

test("keeps the previous strip closed until it is opened", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await prepareState(page, "cards", "light");

  const region = page.getByRole("region", { name: "Previous rounds" });

  await expect(region).toBeVisible();
  await expect(region.getByText("Round 1", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Show previous rounds" }).click();
  await expect(region.getByText("Round 1", { exact: false }).first()).toBeVisible();
});

test("hides toasts after four seconds and lets the user close them", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await prepareState(page, "toast", "light");

  const toast = page.getByTestId("toast").first();
  const close = toast.getByRole("button", { name: "Close notification" });

  await expect(toast).toBeVisible();
  await expect(close).toBeVisible();
  await page.waitForTimeout(4_200);
  await expect(toast).toHaveCount(0);

  await page.getByLabel("Try another direction").fill("A quiet record shop");
  await page.getByRole("button", { name: "Send request" }).click();
  const next = page.getByTestId("toast").first();

  await expect(next).toBeVisible();
  await next.getByRole("button", { name: "Close notification" }).click();
  await expect(next).toHaveCount(0);
});
