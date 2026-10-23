#!/usr/bin/env node
import { runAuditCommand } from "./audit.js";
import { runBoardCommand } from "./board-command.js";
import { getHelpText, getVersion } from "./help.js";
import { runScopesCommand } from "./scopes.js";

interface AuditFlags {
  pages?: string[];
  scope?: string;
}

interface BoardFlags {
  state?: string;
}

function flagValue(args: readonly string[], index: number, name: string): string {
  const inlinePrefix = `${name}=`;
  const value = args[index];

  if (value?.startsWith(inlinePrefix)) {
    return value.slice(inlinePrefix.length);
  }

  const next = args[index + 1];

  if (next === undefined) {
    throw new Error(`Add a value after ${name}.`);
  }

  return next;
}

function auditFlags(args: readonly string[]): AuditFlags {
  const flags: AuditFlags = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === undefined) {
      continue;
    }

    if (value === "--scope" || value.startsWith("--scope=")) {
      flags.scope = flagValue(args, index, "--scope");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    if (value === "--pages" || value.startsWith("--pages=")) {
      const pages = flagValue(args, index, "--pages")
        .split(",")
        .map((page) => page.trim())
        .filter((page) => page !== "");

      flags.pages = pages;
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    throw new Error(`Unknown option ${value}.`);
  }

  return flags;
}

function boardFlags(args: readonly string[]): BoardFlags {
  const flags: BoardFlags = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === undefined) {
      continue;
    }

    if (value === "--state" || value.startsWith("--state=")) {
      flags.state = flagValue(args, index, "--state");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    throw new Error(`Unknown option ${value}.`);
  }

  return flags;
}

async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${getHelpText()}\n`);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  const [command, ...rest] = args;

  if (command === "audit") {
    await runAuditCommand(auditFlags(rest));
    return;
  }

  if (command === "board") {
    const flags = boardFlags(rest);
    const server = await runBoardCommand(
      flags.state === undefined ? {} : { statePath: flags.state },
    );

    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await server.close();
    return;
  }

  if (command === "scopes") {
    await runScopesCommand(rest);
    return;
  }

  throw new Error(`Unknown command ${command ?? ""}. Run fitroom --help.`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Command failed."}\n`);
  process.exitCode = 1;
});
