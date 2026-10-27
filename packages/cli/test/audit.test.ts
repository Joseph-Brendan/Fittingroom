import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { loadScopes } from "@fitroom/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAuditCommand, selectAuditScope } from "../src/audit";
import { runScopesCommand } from "../src/scopes";
import { type FixtureServer, fixturePath, startFixtureServer } from "./helpers/fixture-server";

let badFixture: FixtureServer;
let fixture: FixtureServer;
let goodFixture: FixtureServer;
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
  badFixture = await startFixtureServer(fixturePath("bad-ui"));
  fixture = await startFixtureServer(fixturePath("scope-app"));
  goodFixture = await startFixtureServer(fixturePath("good-ui"));
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "fitroom-cli-"));
  projectRoot = path.join(temporaryDirectory, "scope-app");
  await cp(fixturePath("scope-app"), projectRoot, { recursive: true });
  await mkdir(path.join(projectRoot, ".fitroom"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".fitroom", "last-request.json"),
    JSON.stringify({ path: "/login" }),
  );
});

afterAll(async () => {
  await badFixture.close();
  await fixture.close();
  await goodFixture.close();
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
    await mkdir(path.join(noDefaultRoot, ".fitroom"), { recursive: true });
    await writeFile(
      path.join(noDefaultRoot, ".fitroom", "scopes.json"),
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

  it("writes 1 page and leaves the checklist unticked when no current route is known", async () => {
    const pickerRoot = path.join(temporaryDirectory, "picker-one-page");
    const { output, text } = captureOutput();
    const input = new PassThrough();

    await mkdir(pickerRoot, { recursive: true });
    await cp(path.join(fixturePath("bad-ui"), "app"), path.join(pickerRoot, "app"), {
      recursive: true,
    });

    const selectionPromise = selectAuditScope({
      input,
      output,
      projectRoot: pickerRoot,
    });

    input.end("3\n");

    const selection = await selectionPromise;

    expect(selection.prompted).toBe(true);
    expect(selection.selection.id).toBe("onboarding");
    expect(selection.defaultScopeId).toBeNull();
    expect(text()).toContain("(1 page)");
    expect(text()).not.toContain("(1 pages)");
    expect(text()).not.toContain("[x]");
  });

  it("finds each planted measured bug exactly once in the bad-ui groups", async () => {
    const badRoot = path.join(temporaryDirectory, "bad-ui-groups");
    const { output } = captureOutput();
    const allFindings: Array<{
      citation: string;
      page: string;
      related?: string[];
      selector: string;
      severity: number;
    }> = [];

    await mkdir(badRoot, { recursive: true });
    await cp(path.join(fixturePath("bad-ui"), "app"), path.join(badRoot, "app"), {
      recursive: true,
    });

    for (const scope of [
      "marketing",
      "auth",
      "onboarding",
      "dashboard",
      "app",
      "settings",
      "checkout",
    ]) {
      const result = await runAuditCommand({
        appUrl: badFixture.origin,
        auditOutputDir: path.join(temporaryDirectory, "bad-ui-groups-audits", scope),
        captureOutputDir: path.join(temporaryDirectory, "bad-ui-groups-captures", scope),
        output: output,
        projectRoot: badRoot,
        scope,
      });

      allFindings.push(
        ...result.findings.map((finding) => ({
          citation: finding.citation,
          page: finding.page,
          ...(finding.related === undefined ? {} : { related: finding.related }),
          selector: finding.evidence.selector,
          severity: finding.severity,
        })),
      );
    }

    const plantedBugs = [
      { citation: "wcag22-1.4.3", page: "/", selector: "helper" },
      { citation: "wcag22-2.4.11", page: "/", selector: "focus-target" },
      { citation: "wcag22-1.1.1", page: "/pricing", selector: "img" },
      {
        citation: "wcag22-3.3.2",
        page: "/signup",
        related: ["wcag22-4.1.2"],
        selector: "email",
        severity: 4,
      },
      { citation: "wcag22-2.4.7", page: "/onboarding", selector: "no-focus" },
      { citation: "wcag22-2.5.8", page: "/reports", selector: "icon-save" },
      { citation: "wcag22-1.4.10", page: "/checkout", selector: "wide-panel" },
    ];

    expect(allFindings).toHaveLength(plantedBugs.length);

    for (const bug of plantedBugs) {
      const matches = allFindings.filter(
        (finding) =>
          finding.citation === bug.citation &&
          finding.page === bug.page &&
          finding.selector.includes(bug.selector),
      );

      expect(matches).toHaveLength(1);

      if ("related" in bug) {
        expect(matches[0]).toMatchObject({
          related: bug.related,
          severity: bug.severity,
        });
      }
    }
  }, 180_000);

  it("prints one merged finding and the report paths", async () => {
    const reportRoot = path.join(temporaryDirectory, "report-auth");
    const auditRoot = path.join(temporaryDirectory, "report-auth-audits");
    const { output, text } = captureOutput();

    await mkdir(reportRoot, { recursive: true });
    await cp(path.join(fixturePath("bad-ui"), "app"), path.join(reportRoot, "app"), {
      recursive: true,
    });

    const result = await runAuditCommand({
      appUrl: badFixture.origin,
      auditOutputDir: auditRoot,
      captureOutputDir: path.join(temporaryDirectory, "report-auth-captures"),
      output,
      projectRoot: reportRoot,
      scope: "auth",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      citation: "wcag22-3.3.2",
      page: "/signup",
      related: ["wcag22-4.1.2"],
      severity: 4,
    });
    expect(text()).toContain("Automated findings: 1.");
    expect(text()).toContain("Related: wcag22-4.1.2");
    expect(result.findingsPath).toBeDefined();
    expect(result.reportPath).toBeDefined();

    if (result.findingsPath === undefined || result.reportPath === undefined) {
      throw new Error("The audit did not return both report paths.");
    }

    expect(path.isAbsolute(result.findingsPath)).toBe(true);
    expect(path.isAbsolute(result.reportPath)).toBe(true);
    expect(result.findingsPath.endsWith("findings.json")).toBe(true);
    expect(result.reportPath.endsWith("report.html")).toBe(true);
    expect(text()).toContain(`Findings JSON: ${result.findingsPath}`);
    expect(text()).toContain(`HTML report: ${result.reportPath}`);

    const findingsJson = JSON.parse(await readFile(result.findingsPath, "utf8")) as {
      findings: Array<{ citation: string; related?: string[]; severity: number }>;
    };

    expect(findingsJson.findings).toHaveLength(1);
    expect(findingsJson.findings[0]).toMatchObject({
      citation: "wcag22-3.3.2",
      related: ["wcag22-4.1.2"],
      severity: 4,
    });

    const reportHtml = await readFile(result.reportPath, "utf8");

    expect(reportHtml).toContain("wcag22-3.3.2");
    expect(reportHtml).toContain("wcag22-4.1.2");
    expect(reportHtml).toContain("Form elements must have labels");
  }, 120_000);

  it("finds zero measured findings in every good-ui group", async () => {
    const goodRoot = path.join(temporaryDirectory, "good-ui-groups");
    const { output } = captureOutput();

    await mkdir(goodRoot, { recursive: true });
    await cp(path.join(fixturePath("good-ui"), "app"), path.join(goodRoot, "app"), {
      recursive: true,
    });

    const config = await loadScopes(goodRoot);

    expect(config.scopes.map((scope) => scope.id)).toEqual([
      "marketing",
      "auth",
      "onboarding",
      "dashboard",
      "app",
      "settings",
      "checkout",
    ]);

    for (const scope of config.scopes) {
      const result = await runAuditCommand({
        appUrl: goodFixture.origin,
        auditOutputDir: path.join(temporaryDirectory, "good-ui-groups-audits", scope.id),
        captureOutputDir: path.join(temporaryDirectory, "good-ui-groups-captures", scope.id),
        output: output,
        projectRoot: goodRoot,
        scope: scope.id,
      });

      expect(result.errors).toEqual([]);
      expect(result.findings).toEqual([]);
    }
  }, 180_000);

  it("finds routes by crawling when the project has no app folder", async () => {
    const noAppRoot = path.join(temporaryDirectory, "crawl-no-app");
    const { output, text } = captureOutput();
    const input = new PassThrough();

    await mkdir(noAppRoot, { recursive: true });

    const selectionPromise = selectAuditScope({
      appUrl: badFixture.origin,
      input,
      output,
      projectRoot: noAppRoot,
    });

    input.end("1\n");

    const selection = await selectionPromise;

    expect(selection.selection.id).toBe("marketing");
    expect(text()).toContain(`Found 10 routes by crawling ${badFixture.origin}.`);
    expect(text()).not.toContain("No Next.js App Router folder found.");
  });

  it("reports checks that hit errors and still finishes the audit", async () => {
    const errorRoot = path.join(temporaryDirectory, "audit-errors");
    const routeRoot = path.join(errorRoot, "app", "check-error");
    const { output, text } = captureOutput();

    await mkdir(routeRoot, { recursive: true });
    await cp(path.join(fixturePath("bad-ui"), "app"), path.join(errorRoot, "app"), {
      recursive: true,
    });
    await writeFile(
      path.join(routeRoot, "page.tsx"),
      "export default function Page() {\n  return null;\n}\n",
    );

    const result = await runAuditCommand({
      appUrl: badFixture.origin,
      auditOutputDir: path.join(temporaryDirectory, "audit-errors-audits"),
      captureOutputDir: path.join(temporaryDirectory, "audit-errors-captures"),
      output,
      pages: ["/check-error"],
      projectRoot: errorRoot,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      check: "axe:summary-name",
      page: "/check-error",
      selector: "summary",
    });
    expect(result.findings.map((finding) => finding.citation)).toContain("wcag22-2.5.8");
    expect(text()).toContain("Checks that hit errors:");
    expect(text()).toContain("axe:summary-name");
  }, 120_000);

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

  it("lists one page groups with singular page text", async () => {
    const scopesRoot = path.join(temporaryDirectory, "scopes-singular");
    const { output, text } = captureOutput();

    await mkdir(scopesRoot, { recursive: true });
    await cp(path.join(fixturePath("bad-ui"), "app"), path.join(scopesRoot, "app"), {
      recursive: true,
    });

    await runScopesCommand(["list"], { output, projectRoot: scopesRoot });

    expect(text()).toContain("(1 page)");
    expect(text()).not.toContain("(1 pages)");
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

    const pageRequests = new Set(
      fixture.requests.filter((request) => request !== "/favicon.ico" && request !== "/styles.css"),
    );

    expect(pageRequests).toEqual(new Set(authPages));
  }, 120_000);
});
