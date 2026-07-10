import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const inputSchema = {
  name: z.string().trim().min(1).optional(),
};

// Deliberately does NOT enumerate individual tools - that list already exists
// in the tool catalog itself (and every tool description states its own
// specifics), so duplicating it here would just be a second copy that goes
// stale every time a tool is added, renamed, or removed. This covers what
// doesn't otherwise show up anywhere: the domains present, and rules that cut
// across many tools rather than belonging to any single one.
function formatOrientation(name: string | undefined): string {
  const greeting = name ? `Hello, ${name}.` : "Hello.";

  return [
    `${greeting} This is the TestMu AI Test Manager MCP server.`,
    "",
    "What this server wraps:",
    "- TestMu AI Test Manager: projects, folders, test cases, test runs, Jira linking, users, attachments.",
    "- HyperExecute: job/task/scenario/session execution detail.",
    "- AI Insights: root cause analysis (RCA) for automation failures, plus enriched test execution data (flakiness, smart tags).",
    "",
    "Rules that apply across many tools, not just one:",
    "- Mutating actions (create/update/delete/trigger) are real and persistent against the live account - confirm scope before calling, especially anything described as irreversible.",
    "- AI RCA generation spends real organizational credits and cannot be undone - check for existing RCA before generating new.",
    "- Manual and KaneAI (AI-generated/automation) test cases and test runs are not interchangeable, even where the underlying API doesn't enforce this itself.",
    "- IDs are domain-specific, not interchangeable: a Test Manager test_run_id/test_case_id is a different kind of identifier from a HyperExecute automation_test_id/job_id/task_id/stage_id. Each tool's own description states exactly which one it expects.",
  ].join("\n");
}

export function registerServerInfoTool(server: McpServer): void {
  server.registerTool(
    "tm.get_serverInfo",
    {
      title: "Get Server Orientation",
      description:
        "Returns a short orientation for the TestMu AI Test Manager MCP server: what it wraps " +
        "(Test Manager, HyperExecute, AI Insights/RCA) and a handful of rules that apply across " +
        "many tools (mutating actions are real and persistent, RCA generation costs credits, " +
        "manual vs. KaneAI incompatibility, ID types are not interchangeable). Useful to call " +
        "first if unfamiliar with this server. Does not enumerate individual tools - see the tool " +
        "catalog itself for that.",
      inputSchema,
    },
    async ({ name }) => ({
      content: [{ type: "text", text: formatOrientation(name) }],
    }),
  );
}
