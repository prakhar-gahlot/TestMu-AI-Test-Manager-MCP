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

function formatScenario(scenario: UnknownRecord, index: number): string {
  return [
    `${index + 1}. ${readString(scenario.name) ?? "N/A"}`,
    `   Scenario ID: ${readString(scenario.id) ?? "N/A"}`,
    `   Task ID: ${readString(scenario.taskId) ?? "N/A"}`,
    `   Status: ${readString(scenario.status)?.toUpperCase() ?? "N/A"}`,
    `   Iteration: ${readNumber(scenario.iteration) ?? "N/A"} | Group: ${readNumber(scenario.group_number) ?? "N/A"}`,
    `   Duration: ${readString(scenario.duration) ?? "N/A"}`,
  ].join("\n");
}

// This endpoint's pagination is cursor-based (not page/per_page like most other
// list endpoints in this project), so the shared formatPaginationFooter helper
// (which expects total/current_page/last_page) doesn't fit - `metadata.total`
// here is the count IN THIS PAGE, not a grand total across all pages, and the
// next page is requested by passing this response's own `cursor` value back in.
function formatCursorFooter(metadata: UnknownRecord | undefined): string | undefined {
  const hasMore = metadata?.hasmore === true;
  const cursor = readString(metadata?.cursor);

  if (!hasMore) {
    return undefined;
  }

  return `More scenarios available - pass cursor: "${cursor ?? "N/A"}" to fetch the next page.`;
}

export function registerGetHyperExecuteJobScenariosTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_hyperExecuteJobScenarios",
    {
      title: "Get HyperExecute Job Scenarios",
      description:
        "Lists scenario-level execution details for a HyperExecute Job: one entry per test " +
        "execution attempt (across every Task in the job), each with its scenario ID, parent " +
        "Task ID, name, iteration (retry number, 0 = first attempt), status, group number, and " +
        "duration.\n" +
        "Input: job_id (required, same ID used by tm.get_hyperExecuteJobById). Optional: limit " +
        "(max 20, default 10), cursor (from a previous response's metadata, to fetch the next " +
        "page - returns scenarios with an ID >= the cursor value), status (filter by execution " +
        "status), search_text (filter by occurrence in the scenario name).\n" +
        "IMPORTANT: a status/search_text filter that matches zero scenarios returns a 'not found' " +
        "error here rather than an empty list - this tool distinguishes that case (reported as " +
        "'no scenarios match this filter') from a genuinely invalid/nonexistent job_id (reported " +
        "as 'job not found') using the API's own error text, so the two are not confused. " +
        "Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ job_id, limit, cursor, status, search_text }) => {
      try {
        const response = await client.get(endpoints.hyperexecute.getJobScenarios(job_id), {
          params: { limit, cursor, status, search_text: search_text },
        });
        const scenarios = unwrapDataArray(response);
        const metadata = (response as UnknownRecord | undefined)?.metadata as UnknownRecord | undefined;
        const footer = formatCursorFooter(metadata);

        const lines = [`Scenarios for HyperExecute Job "${job_id}"`, ""];

        if (scenarios.length === 0) {
          lines.push("(no scenarios found)");
        } else {
          lines.push(scenarios.map(formatScenario).join("\n\n"));
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
      if (apiMessage && /no scenarios found/i.test(apiMessage)) {
        return `No scenarios match this filter for job "${jobId}". Try removing the status/search_text filter, or confirm the job actually has scenarios yet.`;
      }
      return `No HyperExecute job found with ID "${jobId}"${apiMessage ? `: ${apiMessage}` : "."}`;
    }

    return `HyperExecute API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve scenarios for HyperExecute job "${jobId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
