#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLambdaTestClient } from "./client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const client = createLambdaTestClient();
  const server = createServer(client);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
