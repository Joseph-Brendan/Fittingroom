import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

interface BoardSession {
  token: string;
  url: string;
}

let session: BoardSession;

test.beforeAll(async () => {
  const sessionPath = path.resolve("e2e", ".empty-board-session.json");

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      session = JSON.parse(await readFile(sessionPath, "utf8")) as BoardSession;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error("The empty board session file did not appear.");
});

test("shows the page group picker, banner, empty state and agent sentence", async ({ page }) => {
  await page.goto(session.url);

  await expect(page.getByRole("heading", { name: "Fitroom", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Page group")).toBeVisible();
  await expect(page.getByText("Design system not found.", { exact: false })).toBeVisible();
  await expect(page.getByText("No directions yet.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Run an audit and generate directions, or click Generate directions.", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByLabel("Page group").selectOption("auth");
  await page.getByRole("button", { name: "Generate directions" }).click();

  await expect(page.getByText("Waiting for your agent.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Ask your agent: Generate 4 design directions for Authentication.", {
      exact: true,
    }),
  ).toBeVisible();
});
