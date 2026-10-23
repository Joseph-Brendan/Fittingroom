import { describe, expect, it } from "vitest";
import { discoverRoutes, groupRoutes } from "../src/index";
import { fixturePath } from "./helpers/fixture-server";

const projectRoot = fixturePath("bad-ui");

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
