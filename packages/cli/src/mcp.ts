import { createFitroomServer } from "@fitroom/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function runMcpCommand(): Promise<void> {
  const server = createFitroomServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
