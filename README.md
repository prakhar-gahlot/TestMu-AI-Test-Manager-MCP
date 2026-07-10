# lambdatest-test-manager-mcp

An MCP (Model Context Protocol) server for LambdaTest Test Manager, built with the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk).

This is currently a scaffold: the server starts and exposes zero tools. Tools will be added incrementally under `src/tools/`.

## Prerequisites

- Node.js 22+
- npm

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and fill in your LambdaTest credentials:

```bash
cp .env.example .env
```

| Variable          | Description                        | Default                       |
| ----------------- | ----------------------------------- | ------------------------------ |
| `LT_USERNAME`     | Your LambdaTest username            | —                               |
| `LT_ACCESS_KEY`   | Your LambdaTest access key          | —                               |
| `LT_TM_BASE_URL`  | Base URL for the LambdaTest Test Manager API | `https://test-manager-api.lambdatest.com` |

## Build & Run

```bash
npm run build
npm start
```

## Development

Run directly from TypeScript source without a build step:

```bash
npm run dev
```

The server communicates over stdio, which is how MCP clients (e.g. Claude Desktop, Claude Code) launch and talk to it.

## Project Structure

```
src/
  index.ts       # Executable entry point: wires client + server + stdio transport
  config.ts      # Environment variable loading and validation (dotenv + zod)
  server.ts      # Constructs the McpServer instance and registers tools
  client.ts      # Reusable HTTP client (get/post/patch/delete) for calling the LambdaTest API
  tools/
    index.ts     # Central place where all tools are registered
```

## Extending with New Tools

1. Create a new file under `src/tools/`, e.g. `src/tools/listTestRuns.ts`.
2. Export a `registerXTool(server, client)` function that calls `server.registerTool(...)` with the tool's name, input schema (Zod), and handler implementation. Use the injected `client` (`get`/`post`/`patch`/`delete`) to call the LambdaTest API — no need to touch axios directly.
3. Import and invoke that function from `src/tools/index.ts`.

Each tool file should have a single responsibility: one tool per file.
