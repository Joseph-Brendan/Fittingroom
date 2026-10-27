import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  updateSnapshots: "none",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  snapshotPathTemplate: "test-reports/board-ui/baselines/{platform}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/board-server.mts",
      url: "http://127.0.0.1:4173/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx e2e/empty-board-server.mts",
      url: "http://127.0.0.1:4174/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx e2e/bridge-server.mts",
      url: "http://127.0.0.1:4175/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx e2e/ui-board-server.mts",
      env: { BOARD_UI_PORT: "4180" },
      url: "http://127.0.0.1:4180/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx e2e/ui-board-server.mts",
      env: { BOARD_UI_APPROVED: "1", BOARD_UI_PORT: "4181" },
      url: "http://127.0.0.1:4181/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx e2e/ui-board-server.mts",
      env: { BOARD_UI_EMPTY: "1", BOARD_UI_PORT: "4182" },
      url: "http://127.0.0.1:4182/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec tsx e2e/ui-board-server.mts",
      env: { BOARD_UI_PORT: "4183", BOARD_UI_WAITING: "1" },
      url: "http://127.0.0.1:4183/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
