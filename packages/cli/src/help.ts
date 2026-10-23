const helpText = [
  "Fitting Room",
  "Try your UI on before you ship it.",
  "",
  "Usage: fitroom <command> [options]",
  "",
  "Commands:",
  "  audit                              Audit a page group.",
  "  board [--state <file>]             Serve the local comparison board.",
  "  scopes                             List saved page groups.",
  "  scopes rename <scope> <name>       Rename a page group.",
  "  scopes merge <target> <source...>  Merge page groups.",
  "  scopes split <scope> --name <name> --pages /one,/two",
  "                                     Split pages into a new group.",
  "",
  "Audit options:",
  "  --scope <scope>                    Use a saved page group.",
  "  --pages <pages>                    Use pages separated by commas.",
  "",
  "Other options:",
  "  -h, --help                         Show this help.",
  "  -v, --version                      Show the version.",
].join("\n");

export function getHelpText(): string {
  return helpText;
}

export function getVersion(): string {
  return "0.0.0";
}
