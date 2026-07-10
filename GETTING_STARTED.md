# Getting Started with the TestMu AI Test Manager MCP Server

This guide is for someone connecting an AI agent (Claude Desktop, Claude Code, or any other
MCP-compatible client) to this server for the first time. It walks through installation,
configuration, and connecting your agent, step by step.

## What is this?

MCP (Model Context Protocol) is a standard way for an AI agent to call external tools during a
conversation, instead of you having to copy-paste API requests by hand. This project is an MCP
*server*: it exposes a set of tools that wrap TestMu AI's Test Manager, HyperExecute, and AI
Insights/RCA APIs. Once connected, your AI agent can create/inspect projects, test cases, and test
runs, look up HyperExecute job/task/execution detail, and fetch or trigger AI root cause analysis
for failures - all directly through conversation, without you needing to know the underlying APIs.

## Prerequisites

- **Node.js 22 or later** - check with `node --version`.
- **npm** (comes with Node).
- **A TestMu AI account with Test Manager access.**
- **An MCP-compatible AI client already installed** - e.g. Claude Desktop, Claude Code, Cursor,
  Windsurf, or any other client that supports MCP servers.

## Step 1: Get your API credentials

This server authenticates to TestMu AI using HTTP Basic Auth with two values:

- `LT_USERNAME` - your TestMu AI username.
- `LT_ACCESS_KEY` - your TestMu AI access key.

Both are available from your account's **Account Settings > Password & Security** page. Keep
these private - treat the access key like a password.

One tool (`tm.link_jiraIssue`, for linking a Jira issue to a test case) also needs:

- `LT_ORG_ID` - your TestMu AI account/org ID. This is optional; the rest of the server works
  without it. If you don't plan to use Jira linking, you can skip this for now.

## Step 2: Install the server

Get a copy of this project onto your machine - clone it if it lives in a git repository you have
access to, or copy the project folder directly. Then, from inside that folder:

```bash
npm install
npm run build
```

`npm run build` compiles the TypeScript source into `dist/`, producing `dist/index.js` - this is
the file your AI client will actually launch.

## Step 3: Configure your credentials

There are two ways to supply credentials - pick whichever fits how you'll run the server.

**Option A - `.env` file** (simplest for local testing):

```bash
cp .env.example .env
```

Then edit `.env` and fill in the values:

```
LT_USERNAME=your-username
LT_ACCESS_KEY=your-access-key
LT_TM_BASE_URL=https://test-manager-api.lambdatest.com
LT_ORG_ID=your-org-id
```

`LT_TM_BASE_URL` already defaults to the value above, so you only need to set it if you're
pointed at a different environment. `LT_ORG_ID` is optional (see Step 1).

**Option B - environment variables in your AI client's config** (recommended once you're
connecting a client, since the client launches the server as its own process and won't
necessarily use this project's working directory): set the same variables directly in the
client's MCP server configuration - see Step 4 below.

If both are present, the client-config environment variables take precedence for that launch.

## Step 4: Connect your AI agent

The server communicates over **stdio** - your AI client starts it as a subprocess and talks to it
over stdin/stdout. Every MCP client configures this the same basic way: a command to run, the
arguments to pass, and (optionally) environment variables. You'll need the **absolute path** to
`dist/index.js` from Step 2.

### Claude Desktop

Open (or create) the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "testmu-test-manager": {
      "command": "node",
      "args": ["/absolute/path/to/TestManagerMCP/dist/index.js"],
      "env": {
        "LT_USERNAME": "your-username",
        "LT_ACCESS_KEY": "your-access-key",
        "LT_ORG_ID": "your-org-id"
      }
    }
  }
}
```

Save the file and **restart Claude Desktop** - MCP servers are only picked up on startup.

### Claude Code

Either edit (or create) `.mcp.json` at the root of the project you're working in, using the same
shape as above:

```json
{
  "mcpServers": {
    "testmu-test-manager": {
      "command": "node",
      "args": ["/absolute/path/to/TestManagerMCP/dist/index.js"],
      "env": {
        "LT_USERNAME": "your-username",
        "LT_ACCESS_KEY": "your-access-key",
        "LT_ORG_ID": "your-org-id"
      }
    }
  }
}
```

or use the `claude mcp add` command (consult `claude mcp add --help` for the exact flags in your
installed version, since these can change between releases) to register the same command, args,
and environment variables without hand-editing JSON.

### Other MCP clients (Cursor, Windsurf, Cline, etc.)

Nearly every MCP client uses this same `command` / `args` / `env` shape, just under a
client-specific config file or settings UI. Look for an "MCP servers" section in your client's
settings and supply:

- **Command:** `node`
- **Args:** `["/absolute/path/to/TestManagerMCP/dist/index.js"]`
- **Env:** `LT_USERNAME`, `LT_ACCESS_KEY`, and optionally `LT_ORG_ID`

## Step 5: Verify it's working

After restarting your client, ask your agent something like:

> "Call the TestMu AI server info tool and tell me what it says."

This calls `tm.get_serverInfo` - a lightweight orientation tool with no required input. If it
responds with a description of the server's domains and rules, the connection is working. If your
agent says it has no such tool available, double check the config file path, that you restarted
the client, and that `npm run build` completed without errors.

## Step 6: Try a real (read-only) call

A safe first real request, once you have a project ID from your TestMu AI account:

> "Get the TestMu AI project with ID `<your-project-id>`."

This should return the project's name, folder structure info, and test case counts - confirming
your credentials are valid and the server can actually reach the TestMu AI API, not just start up.

## Troubleshooting

- **Server exits immediately with "Invalid environment configuration"** - `LT_USERNAME` or
  `LT_ACCESS_KEY` is missing or empty wherever you set them (`.env` or client config `env` block).
- **Agent says the tool doesn't exist** - the client hasn't picked up the config yet; fully
  restart it (not just start a new chat).
- **`node: command not found` or version errors** - confirm Node 22+ is installed and is the
  `node` your client's PATH resolves to (some clients don't inherit your shell's PATH - using an
  absolute path to the `node` binary in `command` can help).
- **Path issues on Windows** - use double backslashes or forward slashes in the JSON `args` path
  (e.g. `"C:/Users/you/TestManagerMCP/dist/index.js"`), not single backslashes.
- **Rebuilt the server but changes aren't showing up** - restart your AI client after every
  `npm run build`; it only reads the compiled `dist/` output at startup, not the TypeScript source.

## Where to go next

Tools are organized by domain: projects/folders, test cases, test runs, Jira linking, users,
HyperExecute (job/task/execution detail), and AI Insights/RCA. Your agent can see every available
tool and its description directly - just ask it what it can do, or ask about a specific area (e.g.
"what can you do with test runs?"). Two things worth knowing up front:

- Actions that create, update, or trigger something are real and persistent against your actual
  TestMu AI account - your agent should confirm before doing anything destructive or costly.
- Generating AI root cause analysis (`tm.generate_testExecutionRCA`) spends real account credits
  and can't be undone - check whether RCA already exists (`tm.get_testExecutionRCA`) before
  triggering new analysis.
