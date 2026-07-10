import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LambdaTestClient } from "./client.js";
import { registerTools } from "./tools/index.js";

export function createServer(client: LambdaTestClient): McpServer {
  const server = new McpServer({
    name: "lambdatest-test-manager-mcp",
    version: "0.1.0",
  });

  registerTools(server, client);

  return server;
}
