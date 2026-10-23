import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { loadScopes } from "@fittingroom/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAuditCommand, selectAuditScope } from "../src/audit";
import { runScopesCommand } from "../src/scopes";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

let fixture: FixtureServer;
let temporaryDirectory: string;
let projectRoot: string;

const authPages = ["/login", "/signup", "/forgot-password", "/verify"];

function captureOutput(): { output: PassThrough; text: () => string } {
  const output = new PassThrough();
  let text = "";

  output.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });

  return { output, text: () => text };
}

beforeAll(async () => {
  fixture = await startFixtureServer(fixturePath("scope-app"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitting-room-cli-"));
  projectRoot = path.join(temporaryDirectory, "scope-app");
  await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
  await mkdir(path.join(projectRoot, ".fittingroom"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".fittingroom", "last-request.json"),
    JSON.stringify({ path: "/login" }),
  );
});

afterAll(async () => {
  await fixture.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("fitroom audit scope selection", () => {
  it("prints a checklist, pre-ticks the browser route scope, and uses it on Enter", async () => {
    const { output, text } = captureOutput();
    const input = new PassThrough();
    const selectionPromise = selectAuditScope({ input, output, projectRoot });

    input.end("\n");

    const selection = await selectionPromise;

    expect(selection.prompted).toBe(true);
    expect(selection.selection.id).toBe("auth");
    expect(selection.selection.pages).toEqual(authPages);
    expect(text()).toMatch(/\[x\] \d+\. Authentication \(4 pages\)/);
    expect(text()).toContain("Select a page group");
  });

  it("asks without a pre-tick when no route or saved scope can be found", async () => {
    const noDefaultRoot = path.join(temporaryDirectory, "no-default");
    const { output, text } = captureOutput();
    const input = new PassThrough();

    await cp(fixturePath("scope-app"), noDefaultRoot, { recursive: true });
    await mkdir(path.join(noDefaultRoot, ".fittingroom"), { recursive: true });
    await writeFile(
      path.join(noDefaultRoot, ".fittingroom", "scopes.json"),
      JSON.stringify({
        version: 1,
        scopes: [{ id: "other", name: "Other", routes: ["/other"] }],
      }),
    );

    const selectionPromise = selectAuditScope({
      input,
      output,
      projectRoot: noDefaultRoot,
    });

    input.end("1\n");

    const selection = await selectionPromise;

    expect(selection.prompted).toBe(true);
    expect(selection.selection.id).toBe("other");
    expect(text()).toContain("Select a page group");
    expect(text()).not.toContain("[x]");
  });

  it("renames and splits saved scopes from the CLI", async () => {
    const scopesRoot = path.join(temporaryDirectory, "scope-commands");

    await cp(fixturePath("scope-app"), scopesRoot, { recursive: true });

    const first = captureOutput();

    await runScopesCommand(["rename", "auth", "Sign in"], {
      output: first.output,
      projectRoot: scopesRoot,
    });
    const second = captureOutput();

    await runScopesCommand(["split", "auth", "--name", "Verification", "--pages", "/verify"], {
      output: second.output,
      projectRoot: scopesRoot,
    });

    const config = await loadScopes(scopesRoot);

    expect(config.scopes.find((scope) => scope.id === "auth")?.name).toBe("Sign in");
    expect(config.scopes.find((scope) => scope.id === "auth")?.routes).toEqual([
      "/login",
      "/signup",
      "/forgot-password",
    ]);
    expect(config.scopes.find((scope) => scope.id === "verification")?.routes).toEqual(["/verify"]);
  });

  it("skips the checklist for --scope and --pages", async () => {
    const scopeOutput = captureOutput();
    const scopeSelection = await selectAuditScope({
      output: scopeOutput.output,
      projectRoot,
      scope: "auth",
    });
    const pagesOutput = captureOutput();
    const pagesSelection = await selectAuditScope({
      output: pagesOutput.output,
      pages: ["/login", "/signup"],
      projectRoot,
    });

    expect(scopeSelection.prompted).toBe(false);
    expect(scopeSelection.selection.pages).toEqual(authPages);
    expect(scopeOutput.text()).toBe("");
    expect(pagesSelection.prompted).toBe(false);
    expect(pagesSelection.selection.pages).toEqual(["/login", "/signup"]);
    expect(pagesOutput.text()).toBe("");
  });

  it("captures only the four auth pages and prints the capture summary", async () => {
    const { output, text } = captureOutput();
    const result = await runAuditCommand({
      appUrl: fixture.origin,
      auditOutputDir: path.join(temporaryDirectory, "audits"),
      captureOutputDir: path.join(temporaryDirectory, "captures"),
      output,
      projectRoot,
      scope: "auth",
    });

    expect(result.summary.id).toBe("auth");
    expect(result.summary.pages).toEqual(authPages);
    expect(result.summary.message).toBe(
      "Capturing: Authentication (4 pages): /login /signup /forgot-password /verify, at 375, 768 and 1440 px.",
    );
    expect(result.pages.map((page) => page.path)).toEqual(authPages);
    expect(result.pages.flatMap((page) => page.screenshots)).toHaveLength(12);
    expect(text()).toContain(result.summary.message);

    const pageRequests = new Set(fixture.requests.filter((request) => request !== "/favicon.ico"));

    expect(pageRequests).toEqual(new Set(authPages));
  }, 120_000);
});
