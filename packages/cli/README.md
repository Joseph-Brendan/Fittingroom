# Fitroom

Try your UI on before you ship it.

Fitroom is a local MCP server and CLI for coding agents. It captures one page group, audits the UI with a citation on every finding, shows four redesign directions on a local board, and checks the build against the chosen design.

## Run

```bash
npx fitroom --help
npx fitroom audit
```

## Run the MCP server

```bash
npx -y fitroom mcp
```

Add it to Claude Code.

```bash
claude mcp add fitroom -- npx -y fitroom mcp
```

Antigravity and Cursor use this JSON.

```json
{
  "mcpServers": {
    "fitroom": {
      "command": "npx",
      "args": ["-y", "fitroom", "mcp"]
    }
  }
}
```

Set the working directory to your app folder.
