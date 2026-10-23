import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(process.argv[2] ?? "fixtures/bad-ui");
const registryPath = path.resolve("packages/citations/registry.json");
const auditsRoot = path.join(projectRoot, ".fittingroom", "audits");
const scopes = [
  "marketing",
  "auth",
  "onboarding",
  "dashboard",
  "app",
  "settings",
  "checkout",
];
const expectedBugs = new Map([
  ["/|wcag22-1.4.3", "bug 1"],
  ["/reports|wcag22-2.5.8", "bug 2"],
  ["/signup|wcag22-3.3.2", "bug 3"],
  ["/onboarding|wcag22-2.4.7", "bug 4"],
  ["/|wcag22-2.4.11", "bug 5"],
  ["/pricing|wcag22-1.1.1", "bug 6"],
  ["/checkout|wcag22-1.4.10", "bug 7"],
]);
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const citationIds = new Set(registry.citations.map((citation) => citation.id));
const seenBugs = new Map();
const problems = [];
let totalFindings = 0;

for (const scope of scopes) {
  const scopeRoot = path.join(auditsRoot, scope);
  const findingsPath = path.join(scopeRoot, "findings.json");
  const reportPath = path.join(scopeRoot, "report.html");

  try {
    await access(findingsPath);
    await access(reportPath);
  } catch {
    problems.push(`${scope}: missing findings.json or report.html`);
    continue;
  }

  const report = JSON.parse(await readFile(findingsPath, "utf8"));

  if (!Array.isArray(report.findings) || !Array.isArray(report.errors)) {
    problems.push(`${scope}: report needs findings and errors arrays`);
    continue;
  }

  if (report.errors.length > 0) {
    problems.push(`${scope}: unexpected check errors: ${JSON.stringify(report.errors)}`);
  }

  for (const finding of report.findings) {
    totalFindings += 1;
    for (const field of ["id", "title", "citation", "confidence", "fix", "page"]) {
      if (typeof finding[field] !== "string" || finding[field].trim() === "") {
        problems.push(`${scope}: finding is missing ${field}`);
      }
    }

    if (!Number.isInteger(finding.severity) || finding.severity < 0 || finding.severity > 4) {
      problems.push(`${scope}: finding ${finding.id} has an invalid severity`);
    }

    if (finding.confidence !== "measured" && finding.confidence !== "judged") {
      problems.push(`${scope}: finding ${finding.id} has an invalid confidence`);
    }

    for (const field of ["selector", "screenshotPath", "measuredValue"]) {
      if (
        typeof finding.evidence?.[field] !== "string" ||
        finding.evidence[field].trim() === ""
      ) {
        problems.push(`${scope}: finding ${finding.id} is missing evidence.${field}`);
      }
    }

    if (typeof finding.evidence?.screenshotPath === "string") {
      try {
        await access(path.resolve(finding.evidence.screenshotPath));
      } catch {
        problems.push(`${scope}: finding ${finding.id} screenshot is missing`);
      }
    }

    if (!citationIds.has(finding.citation)) {
      problems.push(`${scope}: finding ${finding.id} has unknown citation ${finding.citation}`);
    }

    for (const related of finding.related ?? []) {
      if (!citationIds.has(related)) {
        problems.push(`${scope}: finding ${finding.id} has unknown related citation ${related}`);
      }
    }

    if ((finding.related ?? []).includes(finding.citation)) {
      problems.push(`${scope}: finding ${finding.id} repeats its primary citation in related`);
    }

    const key = `${finding.page}|${finding.citation}`;

    if (expectedBugs.has(key)) {
      seenBugs.set(key, (seenBugs.get(key) ?? 0) + 1);
    }

    if (finding.page === "/signup") {
      const related = [...(finding.related ?? [])].sort();

      if (finding.citation !== "wcag22-3.3.2" || related.join(",") !== "wcag22-4.1.2") {
        problems.push(`signup: expected primary wcag22-3.3.2 and related wcag22-4.1.2`);
      }
    }
  }
}

for (const [key, label] of expectedBugs) {
  const count = seenBugs.get(key) ?? 0;

  if (count !== 1) {
    problems.push(`${label} expected 1 finding, got ${count}`);
  }
}

if (totalFindings !== expectedBugs.size) {
  problems.push(`expected ${expectedBugs.size} measured findings, got ${totalFindings}`);
}

console.log(`Scopes checked: ${scopes.length}`);
console.log(`Measured findings: ${totalFindings}`);
console.log(`Expected bugs found: ${seenBugs.size} of ${expectedBugs.size}`);

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Findings JSON validation passed.");
}
