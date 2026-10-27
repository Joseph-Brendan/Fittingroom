import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

interface BoardSession {
  token: string;
  url: string;
}

let session: BoardSession;

test.beforeAll(async () => {
  const sessionPath = path.resolve("e2e", ".board-session.json");

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      session = JSON.parse(await readFile(sessionPath, "utf8")) as BoardSession;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error("The board session file did not appear.");
});

function boardUrl(): string {
  return `/?token=${encodeURIComponent(session.token)}`;
}

test("shows four variants in iframes with names, rationales and finding counts", async ({
  page,
}) => {
  await page.goto(boardUrl());

  await expect(page.getByRole("heading", { name: "Fitroom", level: 1 })).toBeVisible();

  const cards = page.getByTestId("variant-card");

  await expect(cards).toHaveCount(4);

  for (const name of ["Refined", "Clean UI", "Dark-First", "Spatial"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  await expect(page.getByText("1 finding", { exact: true })).toBeVisible();
  await expect(page.getByText("2 findings", { exact: true })).toBeVisible();
  await expect(page.getByText("0 findings", { exact: true })).toHaveCount(2);
  await expect(
    page.getByText("Keeps the layout and fixes the contrast failure in the helper text."),
  ).toBeVisible();

  await expect(
    page
      .frameLocator('iframe[title="Refined preview"]')
      .getByRole("heading", { name: "Refined preview" }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Dark-First preview"]')
      .getByRole("heading", { name: "Dark-First preview" }),
  ).toBeVisible();
});

test("requires the random session token", async ({ page }) => {
  const missing = await page.goto("/");

  expect(missing?.status()).toBe(401);

  const wrong = await page.goto("/?token=wrong-token");

  expect(wrong?.status()).toBe(401);
});

test("switches every preview between 375, 768 and 1440 pixels", async ({ page }) => {
  await page.goto(boardUrl());

  const iframes = page.locator("iframe");

  await expect(iframes).toHaveCount(4);
  await expect(iframes.first()).toHaveAttribute("width", "1440");

  await page.getByRole("button", { name: "375 px" }).click();
  await expect(iframes.first()).toHaveAttribute("width", "375");
  await expect(iframes.last()).toHaveAttribute("width", "375");

  await page.getByRole("button", { name: "768 px" }).click();
  await expect(iframes.first()).toHaveAttribute("width", "768");

  await page.getByRole("button", { name: "1440 px" }).click();
  await expect(iframes.first()).toHaveAttribute("width", "1440");
});

test("opens findings grouped by severity with citation links", async ({ page }) => {
  await page.goto(boardUrl());
  await page.getByRole("button", { name: "Findings (3)" }).click();

  const drawer = page.getByRole("complementary", { name: "Findings drawer" });

  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Severity 4" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Severity 3" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Severity 2" })).toBeVisible();

  const citation = drawer.getByRole("link", { name: "wcag22-1.4.3" });

  await expect(citation).toHaveAttribute(
    "href",
    "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
  );
});

test("sends a new direction request over WebSocket", async ({ page, request }) => {
  await page.goto(boardUrl());

  const input = page.getByLabel("Try another direction");
  const send = page.getByRole("button", { name: "Send request" });

  await expect(send).toBeEnabled();
  await input.fill("Make it feel like a Lagos record shop");
  await send.click();

  await expect(page.getByRole("status")).toHaveText(
    "Request sent. The agent will pick a new direction.",
  );

  const response = await request.get(
    `/api/direction-requests?token=${encodeURIComponent(session.token)}`,
  );

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual([
    expect.objectContaining({ request: "Make it feel like a Lagos record shop" }),
  ]);
});

test("regenerates all, regenerates one card, pins a card, and shows previous rounds", async ({
  page,
}) => {
  await page.goto(boardUrl());

  await page.getByRole("button", { name: "Regenerate Refined" }).click();
  await expect(page.getByRole("heading", { name: "Refined 1", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clean UI", exact: true })).toBeVisible();

  const previous = page.getByRole("region", { name: "Previous rounds" });

  await expect(previous).toBeVisible();
  await page.getByRole("button", { name: "Show previous rounds" }).click();
  await expect(previous.getByText("Refined / Clean UI / Dark-First / Spatial")).toBeVisible();

  await page.getByRole("button", { name: "Pin Clean UI" }).click();
  await expect(page.getByRole("button", { name: "Unpin Clean UI" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Refined mode").selectOption("deep");
  await page.getByRole("button", { name: "Regenerate all" }).click();

  await expect(page.getByRole("heading", { name: "Refined 2", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dark-First 2", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Clean UI", exact: true })).toBeVisible();
  await expect(previous.getByText("Refined 1 / Clean UI / Dark-First / Spatial")).toBeVisible();
});

async function lastEdit(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ op: string }> {
  const response = await request.get(`/api/edit-log?token=${encodeURIComponent(session.token)}`);

  expect(response.ok()).toBe(true);
  const log = (await response.json()) as Array<{ op: string }>;
  const entry = log.at(-1);

  if (entry === undefined) {
    throw new Error("The board did not record an edit.");
  }

  return entry;
}

test("selects an iframe element, shows token options, and warns on custom values", async ({
  page,
  request,
}) => {
  await page.goto(boardUrl());

  await expect(page.getByText("Design system connected:")).toBeVisible();

  const frame = page.frameLocator('iframe[data-variant-slug="refined"]');

  await frame.getByRole("heading", { name: "Refined preview" }).click();

  const inspector = page.getByRole("complementary", { name: "Inspector" });

  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId("selected-fr-id")).toHaveText("page-title");

  const color = inspector.getByLabel("Color");
  const optionTexts = await color.locator("option").allTextContents();

  expect(optionTexts.slice(1)).toEqual(["brand (#1d4ed8)", "text (#111827)", "Custom value"]);

  await color.selectOption("color.brand");
  await expect(frame.getByRole("heading", { name: "Refined preview" })).toHaveCSS(
    "color",
    "rgb(29, 78, 216)",
  );
  expect((await lastEdit(request)).op).toBe("set-token");

  await color.selectOption("custom");
  await expect(inspector.getByText("Custom value, not in your system.")).toBeVisible();
});

test("deletes an element and undoes the delete", async ({ page, request }) => {
  await page.goto(boardUrl());

  const frame = page.frameLocator('iframe[data-variant-slug="native"]');

  await frame.getByText("Keep the important parts close.").click();
  await page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("button", {
      name: "Delete",
    })
    .click();

  await expect(frame.getByText("Keep the important parts close.")).toHaveCount(0);
  expect((await lastEdit(request)).op).toBe("delete");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(frame.getByText("Keep the important parts close.")).toBeVisible();
});

test("duplicates an element", async ({ page, request }) => {
  await page.goto(boardUrl());

  const frame = page.frameLocator('iframe[data-variant-slug="bold"]');

  await frame.getByRole("heading", { name: "Dark-First preview" }).click();
  await page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("button", {
      name: "Duplicate",
    })
    .click();

  await expect(frame.getByRole("heading", { name: "Dark-First preview" })).toHaveCount(2);
  expect((await lastEdit(request)).op).toBe("duplicate");
});

test("inserts a project component before basic components", async ({ page, request }) => {
  await page.goto(boardUrl());

  const frame = page.frameLocator('iframe[data-variant-slug="wildcard"]');

  await frame.getByText("Feature A").click();

  const inspector = page.getByRole("complementary", { name: "Inspector" });

  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId("selected-fr-id")).toBeVisible();

  const insert = inspector.getByLabel("Insert component");
  const options = await insert.locator("option").allTextContents();

  expect(options[0]).toBe("Button (project)");

  await inspector.getByRole("button", { name: "Insert" }).click();
  await expect(frame.getByRole("button", { name: "button" })).toBeVisible();
  expect((await lastEdit(request)).op).toBe("insert");
});

test("reorders siblings with dnd-kit", async ({ page, request }) => {
  await page.goto(boardUrl());

  const frame = page.frameLocator('iframe[data-variant-slug="native"]');

  await frame.getByText("Feature A").click();

  const source = page.getByRole("button", { name: "Drag Feature A" });
  const target = page.getByRole("button", { name: "Drag Feature B" });

  await source.dragTo(target);

  await expect.poll(async () => (await lastEdit(request)).op).toBe("move");
  await expect
    .poll(async () => {
      try {
        return await frame.locator('section[data-fr-id="features"] > div').allTextContents();
      } catch {
        return [];
      }
    })
    .toEqual(["Feature B", "Feature A"]);
});
