#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFittingRoomServer } from "./server.js";

const server = createFittingRoomServer();
const transport = new StdioServerTransport();

await server.connect(transport);
