#!/usr/bin/env node
import { runAuditCommand } from "./audit.js";
import { runBoardCommand } from "./board-command.js";
import { getHelpText, getVersion } from "./help.js";
import { runMcpCommand } from "./mcp.js";
import { runScopesCommand } from "./scopes.js";

interface AuditFlags {
  pages?: string[];
  scope?: string;
  url?: string;
}

interface BoardFlags {
  port?: number;
  scope?: string;
  state?: string;
  url?: string;
}

function portValue(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Port must be a whole number from 0 to 65535. Run fitroom board --help.");
  }

  return port;
}

function flagValue(args: readonly string[], index: number, name: string, command: string): string {
  const inlinePrefix = `${name}=`;
  const value = args[index];

  if (value?.startsWith(inlinePrefix)) {
    return value.slice(inlinePrefix.length);
  }

  const next = args[index + 1];

  if (next === undefined) {
    throw new Error(`Add a value after ${name}. Run fitroom ${command} --help.`);
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

    if (value === "--url" || value.startsWith("--url=")) {
      flags.url = flagValue(args, index, "--url", "audit");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    if (value === "--scope" || value.startsWith("--scope=")) {
      flags.scope = flagValue(args, index, "--scope", "audit");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    if (value === "--pages" || value.startsWith("--pages=")) {
      const pages = flagValue(args, index, "--pages", "audit")
        .split(",")
        .map((page) => page.trim())
        .filter((page) => page !== "");

      flags.pages = pages;
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    throw new Error(
      `Unknown option ${value}. Valid options: --url, --scope, --pages. Run fitroom audit --help.`,
    );
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

    if (value === "--url" || value.startsWith("--url=")) {
      flags.url = flagValue(args, index, "--url", "board");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    if (value === "--scope" || value.startsWith("--scope=")) {
      flags.scope = flagValue(args, index, "--scope", "board");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    if (value === "--state" || value.startsWith("--state=")) {
      flags.state = flagValue(args, index, "--state", "board");
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    if (value === "--port" || value.startsWith("--port=")) {
      flags.port = portValue(flagValue(args, index, "--port", "board"));
      index += value.includes("=") ? 0 : 1;
      continue;
    }

    throw new Error(
      `Unknown option ${value}. Valid options: --url, --scope, --state, --port. Run fitroom board --help.`,
    );
  }

  return flags;
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${getHelpText()}\n`);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(`${getHelpText(command)}\n`);
    return;
  }

  if (command === "audit") {
    const flags = auditFlags(rest);

    await runAuditCommand({
      ...(flags.pages === undefined ? {} : { pages: flags.pages }),
      ...(flags.scope === undefined ? {} : { scope: flags.scope }),
      ...(flags.url === undefined ? {} : { appUrl: flags.url }),
    });
    return;
  }

  if (command === "board") {
    const flags = boardFlags(rest);
    const server = await runBoardCommand({
      ...(flags.state === undefined ? {} : { statePath: flags.state }),
      ...(flags.scope === undefined ? {} : { scope: flags.scope }),
      ...(flags.url === undefined ? {} : { appUrl: flags.url }),
      ...(flags.port === undefined ? {} : { port: flags.port }),
    });

    if (server.reused === true) {
      return;
    }

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

  if (command === "mcp") {
    await runMcpCommand();
    return;
  }

  throw new Error(`Unknown command ${command}. Run fitroom --help.`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Command failed."}\n`);
  process.exitCode = 1;
});
