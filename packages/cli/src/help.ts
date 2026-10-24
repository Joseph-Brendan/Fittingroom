const helpText = [
  "Fitting Room",
  "Try your UI on before you ship it.",
  "",
  "Usage: fitroom <command> [options]",
  "",
  "Commands:",
  "  audit [options]                    Audit one page group.",
  "  board [options]                    Serve the local comparison board.",
  "  scopes [action] [options]          List or edit saved page groups.",
  "  mcp                                Start the MCP server over stdio.",
  "",
  "Command options:",
  "  --url <url>       Set the app URL for audit or board.",
  "  --scope <scope>   Use a saved page group.",
  "  --pages <pages>   Use pages separated by commas for audit.",
  "  --state <file>    Read board state from this file.",
  "",
  "Examples:",
  "  fitroom audit --url http://localhost:3000",
  "  fitroom board --url http://localhost:3000",
  "",
  "Run fitroom <command> --help for all options.",
  "",
  "Other options:",
  "  -h, --help                         Show this help.",
  "  -v, --version                      Show the version.",
].join("\n");

const auditHelpText = [
  "Usage: fitroom audit [options]",
  "",
  "Audit one page group of your app.",
  "",
  "Options:",
  "  --url <url>       Audit the app at this URL. Without it, Fitting Room finds a local dev server.",
  "  --scope <scope>   Use a saved page group. This skips the picker.",
  "  --pages <pages>   Use pages separated by commas. This skips the picker.",
  "  -h, --help        Show this help.",
  "",
  "Examples:",
  "  fitroom audit --url http://localhost:3000",
  "  fitroom audit --url http://localhost:3000 --scope marketing",
  "  fitroom audit --url http://localhost:3000 --pages /,/pricing",
].join("\n");

const boardHelpText = [
  "Usage: fitroom board [options]",
  "",
  "Serve the local comparison board on 127.0.0.1.",
  "",
  "Options:",
  "  --url <url>       Set the app URL for this board session.",
  "  --scope <scope>   Show this saved page group.",
  "  --state <file>    Read board state from this file. Defaults to .fittingroom/board.json.",
  "  -h, --help        Show this help.",
  "",
  "Examples:",
  "  fitroom board --url http://localhost:3000",
  "  fitroom board --url http://localhost:3000 --scope marketing",
  "  fitroom board --state .fittingroom/board.json",
].join("\n");

const scopesHelpText = [
  "Usage: fitroom scopes [list]",
  "       fitroom scopes rename <scope> <name>",
  "       fitroom scopes merge <target> <source...>",
  "       fitroom scopes split <scope> --name <name> --pages /one,/two",
  "",
  "List and edit saved page groups.",
  "",
  "Options:",
  "  --name <name>     Name the new group for split.",
  "  --pages <pages>   Pages separated by commas for split.",
  "  --id <id>         Set the new group id for split.",
  "  -h, --help        Show this help.",
  "",
  "Examples:",
  "  fitroom scopes",
  '  fitroom scopes rename auth "Sign in"',
  "  fitroom scopes split auth --name Verification --pages /verify",
].join("\n");

const mcpHelpText = [
  "Usage: fitroom mcp",
  "",
  "Start the MCP server over stdio.",
  "",
  "Run it from the folder of the app you are testing.",
  "",
  "Options:",
  "  -h, --help        Show this help.",
].join("\n");

const commandHelp: Record<string, string> = {
  audit: auditHelpText,
  board: boardHelpText,
  mcp: mcpHelpText,
  scopes: scopesHelpText,
};

export function getHelpText(command?: string): string {
  if (command === undefined) {
    return helpText;
  }

  return commandHelp[command] ?? helpText;
}

export function getVersion(): string {
  return "0.0.0";
}
