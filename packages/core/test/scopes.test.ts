import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  detectDefaultScope,
  discoverRoutes,
  findLastEditedRoute,
  loadScopes,
  mergeScopes,
  readDevServerLastRequest,
  recordDevServerRequest,
  renameScope,
  resolveDefaultScope,
  splitScope,
} from "../src/index";
import { fixturePath } from "./helpers/fixture-server";

const scopeFixture = fixturePath("scope-app");
let temporaryDirectory: string;
let projectRoot: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fittingroom-scopes-"));
  projectRoot = path.join(temporaryDirectory, "scope-app");

  await cp(scopeFixture, projectRoot, { recursive: true });
});

afterAll(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("scope definitions", () => {
  it("builds five default scopes from the 14-route fixture", async () => {
    const config = await loadScopes(projectRoot);
    const auth = config.scopes.find((scope) => scope.id === "auth");

    expect(config.scopes).toHaveLength(5);
    expect(config.scopes.reduce((total, scope) => total + scope.routes.length, 0)).toBe(14);
    expect(auth).toEqual({
      id: "auth",
      name: "Authentication",
      routes: ["/login", "/signup", "/forgot-password", "/verify"],
    });
    expect(config.scopes.map((scope) => scope.id)).toEqual([
      "marketing",
      "auth",
      "dashboard",
      "settings",
      "checkout",
    ]);
  });

  it("renames, merges, and splits scopes, then reloads the saved file", async () => {
    await renameScope(projectRoot, "auth", "Sign in");

    const merged = await mergeScopes(projectRoot, "marketing", ["settings"]);

    expect(merged.scopes.find((scope) => scope.id === "auth")?.name).toBe("Sign in");
    expect(merged.scopes.find((scope) => scope.id === "settings")).toBeUndefined();
    expect(merged.scopes.find((scope) => scope.id === "marketing")?.routes).toEqual([
      "/",
      "/about",
      "/pricing",
      "/settings",
      "/settings/security",
    ]);

    const split = await splitScope(projectRoot, "auth", {
      id: "verification",
      name: "Verification",
      routes: ["/verify"],
    });
    const reloaded = await loadScopes(projectRoot);
    const raw = JSON.parse(
      await readFile(path.join(projectRoot, ".fittingroom", "scopes.json"), "utf8"),
    ) as { scopes: Array<{ id: string; routes: string[] }> };

    expect(split.scopes.find((scope) => scope.id === "auth")?.routes).toEqual([
      "/login",
      "/signup",
      "/forgot-password",
    ]);
    expect(reloaded.scopes.find((scope) => scope.id === "verification")?.routes).toEqual([
      "/verify",
    ]);
    expect(raw.scopes.find((scope) => scope.id === "verification")?.routes).toEqual(["/verify"]);
  });
});

describe("default scope selection", () => {
  it("prefers the dev server request over the last edited route", async () => {
    const selectionRoot = path.join(temporaryDirectory, "scope-default-config");

    await cp(scopeFixture, selectionRoot, { recursive: true });

    const config = await loadScopes(selectionRoot);
    const fromRequest = resolveDefaultScope(config, {
      lastRequestedRoute: "/login",
      lastEditedRoute: "/settings/security",
    });
    const fromEdit = resolveDefaultScope(config, {
      lastRequestedRoute: null,
      lastEditedRoute: "/settings/security",
    });

    expect(fromRequest).toMatchObject({
      route: "/login",
      source: "dev-server",
      scope: { id: "auth" },
    });
    expect(fromEdit).toMatchObject({
      route: "/settings/security",
      source: "last-edited",
      scope: { id: "settings" },
    });
    expect(resolveDefaultScope(config, {})).toBeNull();
  });

  it("reads the tracked dev request and uses an explicit last edited route", async () => {
    const isolatedRoot = path.join(temporaryDirectory, "scope-defaults");

    await cp(scopeFixture, isolatedRoot, { recursive: true });

    const config = await loadScopes(isolatedRoot);
    const routes = await discoverRoutes(isolatedRoot);
    const verifyFile = routes.find((route) => route.path === "/verify")?.file;

    expect(verifyFile).toBeDefined();

    if (verifyFile === undefined) {
      throw new Error("Missing verify route.");
    }

    await recordDevServerRequest(isolatedRoot, "/login?from=tracker");
    const newer = new Date(Date.now() + 10_000);

    await utimes(path.join(isolatedRoot, verifyFile), newer, newer);

    const lastEditedRoute = await findLastEditedRoute(isolatedRoot, routes);

    expect(await readDevServerLastRequest(isolatedRoot)).toBe("/login");
    expect(lastEditedRoute).toBe("/verify");
    expect(
      await detectDefaultScope(isolatedRoot, config, routes, {
        lastRequestedRoute: null,
        lastEditedRoute,
      }),
    ).toMatchObject({
      route: "/verify",
      source: "last-edited",
      scope: { id: "auth" },
    });
    expect(
      await detectDefaultScope(isolatedRoot, config, routes, {
        lastRequestedRoute: null,
      }),
    ).toBeNull();
  });
});

describe("scope state files", () => {
  it("creates scopes.json with valid defaults when it is missing", async () => {
    const root = path.join(temporaryDirectory, "missing-scopes");

    await cp(scopeFixture, root, { recursive: true });
    await rm(path.join(root, ".fittingroom"), { force: true, recursive: true });

    const config = await loadScopes(root);
    const filePath = path.join(root, ".fittingroom", "scopes.json");

    expect(config.scopes).toHaveLength(5);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(config);
  });

  it("does not overwrite an existing scopes.json", async () => {
    const root = path.join(temporaryDirectory, "existing-scopes");
    const existing = {
      version: 1,
      scopes: [{ id: "custom", name: "Custom", routes: ["/"] }],
    };

    await cp(scopeFixture, root, { recursive: true });
    await mkdir(path.join(root, ".fittingroom"), { recursive: true });
    await writeFile(
      path.join(root, ".fittingroom", "scopes.json"),
      `${JSON.stringify(existing, null, 2)}\n`,
    );

    expect(await loadScopes(root)).toEqual(existing);
    expect(
      JSON.parse(await readFile(path.join(root, ".fittingroom", "scopes.json"), "utf8")),
    ).toEqual(existing);
  });

  it("creates last-request.json with a null path when it is missing", async () => {
    const root = path.join(temporaryDirectory, "missing-last-request");

    await mkdir(root, { recursive: true });

    expect(await readDevServerLastRequest(root)).toBeNull();
    expect(
      JSON.parse(await readFile(path.join(root, ".fittingroom", "last-request.json"), "utf8")),
    ).toEqual({ path: null });
  });

  it("gives a plain error for corrupt scopes.json", async () => {
    const root = path.join(temporaryDirectory, "corrupt-scopes");

    await cp(scopeFixture, root, { recursive: true });
    await mkdir(path.join(root, ".fittingroom"), { recursive: true });
    await writeFile(path.join(root, ".fittingroom", "scopes.json"), '{"version": 1, "scopes": ');

    await expect(loadScopes(root)).rejects.toThrow(
      /scopes\.json.*not valid JSON.*Fix the file or delete it/,
    );
  });
});
