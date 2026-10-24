import { createFittingRoomServer } from "@fittingroom/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function runMcpCommand(): Promise<void> {
  const server = createFittingRoomServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
