import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapDataArray, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  job_id: z.string().trim().min(1, "job_id is required"),
  limit: z.number().int().positive().max(20, "limit cannot exceed 20").optional(),
  cursor: z.string().trim().optional(),
  status: z.string().trim().optional(),
  search_text: z.string().trim().optional(),
};

function formatSession(session: UnknownRecord, index: number): string {
  const sessionId = readString(session.sessionID);
  const testId = readString(session.testID);

  return [
    `${index + 1}. ${readString(session.scenario_name) ?? readString(session.name) ?? "N/A"}`,
    // sessionID and testID have been observed identical - shown as one line
    // rather than two when they match, to avoid redundant noise.
    sessionId && sessionId === testId
      ? `   Session/Test ID: ${sessionId}`
      : `   Session ID: ${sessionId ?? "N/A"} | Test ID: ${testId ?? "N/A"}`,
    `   Task ID: ${readString(session.taskID) ?? "N/A"}`,
    `   Status: ${readString(session.status)?.toUpperCase() ?? "N/A"}`,
    `   Group: ${readNumber(session.group_number) ?? "N/A"} | SmartUI: ${session.smartUI_enabled === true ? "Yes" : "No"}`,
    `   Duration: ${readString(session.duration) ?? "N/A"}`,
  ].join("\n");
}

// Cursor-based pagination (not page/per_page), same shape as
// getHyperExecuteJobScenarios.ts - metadata.total means "count in this page,"
// not a grand total, so the shared formatPaginationFooter helper (built for
// page/per_page/total) doesn't fit here either.
function formatCursorFooter(metadata: UnknownRecord | undefined): string | undefined {
  const hasMore = metadata?.hasmore === true;
  const cursor = readString(metadata?.cursor);

  if (!hasMore) {
    return undefined;
  }

  return `More sessions available - pass cursor: "${cursor ?? "N/A"}" to fetch the next page.`;
}

export function registerGetHyperExecuteJobSessionsTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_hyperExecuteJobSessions",
    {
      title: "Get HyperExecute Job Sessions",
      description:
        "Lists session-level execution details for a HyperExecute Job: one entry per test " +
        "execution that reached an actual Selenium/Appium session (a retried test appears as a " +
        "separate session entry, not an iteration counter - unlike tm.get_hyperExecuteJobScenarios, " +
        "which lists every attempt including ones that never got a session). Each entry has its " +
        "session/test ID (the same automation_test_id used by tm.get_testExecutionHistoryByTestCaseId, " +
        "tm.get_testCaseInstancesByTestRunId, and tm.get_testExecutionRCA), parent Task ID, scenario " +
        "name, status, group number, duration, and whether SmartUI was enabled.\n" +
        "Input: job_id (required, same ID used by tm.get_hyperExecuteJobById). Optional: limit " +
        "(max 20, default 10), cursor (from a previous response's metadata, to fetch the next " +
        "page - returns sessions with an ID >= the cursor value), status (filter by execution " +
        "status), search_text (filter by occurrence in the scenario name).\n" +
        "IMPORTANT: a status/search_text filter that matches zero sessions returns a 'not found' " +
        "error here rather than an empty list - this tool distinguishes that case (reported as " +
        "'no sessions match this filter') from a genuinely invalid/nonexistent job_id (reported " +
        "as 'job not found') using the API's own error text. A test that never got a session at " +
        "all (failed before one was created) will not appear here regardless of filters. Read-only; " +
        "does not modify anything.",
      inputSchema,
    },
    async ({ job_id, limit, cursor, status, search_text }) => {
      try {
        const response = await client.get(endpoints.hyperexecute.getJobSessions(job_id), {
          params: { limit, cursor, status, search_text: search_text },
        });
        const sessions = unwrapDataArray(response);
        const metadata = (response as UnknownRecord | undefined)?.metadata as UnknownRecord | undefined;
        const footer = formatCursorFooter(metadata);

        const lines = [`Sessions for HyperExecute Job "${job_id}"`, ""];

        if (sessions.length === 0) {
          lines.push("(no sessions found)");
        } else {
          lines.push(sessions.map(formatSession).join("\n\n"));
          if (footer) {
            lines.push("", footer);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, job_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller. A 404 here can mean either a bad
// job_id or a filter that matched nothing - the API's own `error` message
// text distinguishes the two, so it's checked rather than treating every 404
// the same way.
function describeError(error: unknown, jobId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { error?: string } | undefined)?.error;

    if (status === 404) {
      if (apiMessage && /no sessions found/i.test(apiMessage)) {
        return `No sessions match this filter for job "${jobId}". Try removing the status/search_text filter, or confirm the relevant test(s) actually reached a session (see tm.get_hyperExecuteJobScenarios for attempts that never got that far).`;
      }
      return `No HyperExecute job found with ID "${jobId}"${apiMessage ? `: ${apiMessage}` : "."}`;
    }

    return `HyperExecute API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve sessions for HyperExecute job "${jobId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
