#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFitroomServer } from "./server.js";

const server = createFitroomServer();
const transport = new StdioServerTransport();

await server.connect(transport);
