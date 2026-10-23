import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverRoutes, groupRoutes } from "../src/index";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

const projectRoot = fixturePath("bad-ui");
const expectedRoutePaths = [
  "/",
  "/analytics",
  "/checkout",
  "/dashboard",
  "/login",
  "/onboarding",
  "/pricing",
  "/reports",
  "/settings",
  "/signup",
];

let badServer: FixtureServer;
let temporaryDirectory: string;

beforeAll(async () => {
  badServer = await startFixtureServer(fixturePath("bad-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-routes-"));
});

afterAll(async () => {
  await badServer.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("Next.js App Router discovery", () => {
  it("lists pages and drops route group folders from URLs", async () => {
    const routes = await discoverRoutes(projectRoot);

    expect(routes.map((route) => route.path)).toEqual([
      "/",
      "/analytics",
      "/checkout",
      "/dashboard",
      "/login",
      "/onboarding",
      "/pricing",
      "/reports",
      "/settings",
      "/signup",
    ]);

    const login = routes.find((route) => route.path === "/login");

    expect(login?.file).toBe("app/(auth)/login/page.tsx");
    expect(login?.routeGroups).toEqual(["auth"]);
    expect(login?.layouts).toEqual(["app/layout.tsx", "app/(auth)/layout.tsx"]);
  });

  it("keeps shared layouts with each route", async () => {
    const routes = await discoverRoutes(projectRoot);
    const reports = routes.find((route) => route.path === "/reports");
    const home = routes.find((route) => route.path === "/");

    expect(reports?.layouts).toContain("app/(app)/layout.tsx");
    expect(home?.layouts).toEqual(["app/layout.tsx", "app/(marketing)/layout.tsx"]);
  });

  it("gives good-ui and bad-ui the same route list", async () => {
    const badRoutes = await discoverRoutes(fixturePath("bad-ui"));
    const goodRoutes = await discoverRoutes(fixturePath("good-ui"));

    expect(goodRoutes.map((route) => route.path)).toEqual(badRoutes.map((route) => route.path));
  });

  it("crawls same-origin links when there is no app folder", async () => {
    const noAppRoot = path.join(temporaryDirectory, "no-app");

    await mkdir(noAppRoot, { recursive: true });

    const routes = await discoverRoutes(noAppRoot, { fallbackUrl: badServer.origin });

    expect(routes.map((route) => route.path)).toEqual(expectedRoutePaths);
  });

  it("stops crawling at the page limit", async () => {
    const noAppRoot = path.join(temporaryDirectory, "crawl-limit");

    await mkdir(noAppRoot, { recursive: true });

    const routes = await discoverRoutes(noAppRoot, {
      fallbackUrl: badServer.origin,
      maxPages: 3,
    });

    expect(routes).toHaveLength(3);
  });
});

describe("groupRoutes", () => {
  it("sorts routes into the seven page groups", async () => {
    const grouped = groupRoutes(await discoverRoutes(projectRoot));

    expect(grouped.marketing.map((route) => route.path)).toEqual(["/", "/pricing"]);
    expect(grouped.auth.map((route) => route.path)).toEqual(["/login", "/signup"]);
    expect(grouped.onboarding.map((route) => route.path)).toEqual(["/onboarding"]);
    expect(grouped.dashboard.map((route) => route.path)).toEqual(["/analytics", "/dashboard"]);
    expect(grouped.app.map((route) => route.path)).toEqual(["/reports"]);
    expect(grouped.settings.map((route) => route.path)).toEqual(["/settings"]);
    expect(grouped.checkout.map((route) => route.path)).toEqual(["/checkout"]);
  });
});
