# TestMu AI Test Manager MCP

An MCP (Model Context Protocol) server for TestMu AI Test Manager, HyperExecute, and AI Insights,
built with the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk).

New to MCP, or setting this up for the first time? See [GETTING_STARTED.md](GETTING_STARTED.md)
for a step-by-step walkthrough, including how to connect Claude Desktop, Claude Code, or another
MCP client.

## What this server provides

Tools are organized by domain under `src/tools/`:

- **projects/**, **folders/** - TestMu AI Test Manager projects and test-case folders.
- **testCases/** - create/read/update test cases and their execution history.
- **testRuns/** - test runs and test-run folders, per-instance status/steps, bulk updates.
- **jira/** - link/unlink Jira issues, execution history by Jira ID.
- **environments/** - browser/OS/device environment lookup.
- **users/** - organization user lookup (for assignees).
- **attachments/** - file uploads for test steps/instances.
- **hyperexecute/** - HyperExecute job/task/scenario/session execution detail.
- **insights/** - AI-powered root cause analysis (RCA) and enriched test execution data.

## Prerequisites

- Node.js 22+
- npm
- A TestMu AI account with Test Manager access

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and fill in your TestMu AI credentials:

```bash
cp .env.example .env
```

| Variable         | Description                                                                    | Default                                   |
| ---------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `LT_USERNAME`    | Your LambdaTest username                                                        | —                                          |
| `LT_ACCESS_KEY`  | Your LambdaTest access key                                                      | —                                          |
| `LT_TM_BASE_URL` | Base URL for the LambdaTest Test Manager API                                    | `https://test-manager-api.lambdatest.com` |
| `LT_ORG_ID`      | Your LambdaTest account/org ID - optional, only needed by `tm.link_jiraIssue`   | —                                          |

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

The server communicates over stdio, which is how MCP clients (e.g. Claude Desktop, Claude Code)
launch and talk to it.

## Project Structure

```rb
src/
  index.ts        # Executable entry point: wires client + server + stdio transport
  config.ts        # Environment variable loading and validation (dotenv + zod)
  server.ts         # Constructs the McpServer instance and registers tools
  client.ts          # Reusable HTTP client (get/post/patch/delete/postForm) for calling the TestMu AI API
  config/
    endpoints.ts      # Centralized registry of API endpoint paths - tools never hardcode a path
  utils/
    response.ts         # Shared defensive-parsing helpers for reading API responses
  tools/
    index.ts             # Central place where all tools are registered
    serverInfo.ts         # Orientation tool (tm.get_serverInfo)
    projects/, folders/, testCases/, jira/, testRuns/, environments/, users/,
    attachments/, hyperexecute/, insights/
                          # One domain per subfolder, one tool per file
```

## Extending with New Tools

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full set of conventions this project's tools
follow (naming, file layout, input validation, response parsing, error handling, and rules for
what belongs in a tool's own description vs. internal dev notes) - read it before adding a new
tool, so the server keeps evolving consistently.
