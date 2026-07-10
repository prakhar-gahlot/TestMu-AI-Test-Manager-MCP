import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// This endpoint isn't in LambdaTest's published OpenAPI docs - it was
// sourced from the browser network inspector. Its response shape is
// unconfirmed, so success is judged only by the HTTP status (no 2xx throws),
// and any message/type fields in the body are surfaced defensively if present.
const inputSchema = {
  test_run_id: z.string().trim().min(1, "test_run_id is required"),
  status: z.enum(["Skipped", "In Progress", "Failed", "Passed"]),
};

export function registerUpdateTestRunStatusTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.update_testRunStatus",
    {
      title: "Update Test Manager Test Run Status",
      description:
        "Sets the overall status of a LambdaTest Test Manager test run to one of 'Skipped', " +
        "'In Progress', 'Failed', or 'Passed'. This is undocumented (sourced from the browser " +
        "network inspector, not the official API docs), so treat it as best-effort. This changes the " +
        "run's own status field - it does not touch per-instance execution results. Do not call this " +
        "speculatively - it's a real, persistent action.",
      inputSchema,
    },
    async ({ test_run_id, status }) => {
      try {
        const response = await client.put(endpoints.testRuns.updateStatus(test_run_id), { status });
        const result = unwrapData(response);

        const message = readString(result?.message);
        return {
          content: [
            {
              type: "text",
              text: message
                ? `Test run "${test_run_id}" status updated to "${status}": ${message}`
                : `Test run "${test_run_id}" status updated to "${status}".`,
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, test_run_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, testRunId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422 || status === 404) {
      return `Test run not found: ${apiMessage ?? `no test run exists with ID "${testRunId}".`}`;
    }

    if (status === 403) {
      return (
        `Could not update test run "${testRunId}": ${apiMessage ?? "not allowed."} This endpoint returns 403 ` +
        "for a nonexistent test run ID (rather than 404/422 like other test-run endpoints), but it can also " +
        "mean a genuine permissions issue - double-check the ID first."
      );
    }

    if (status === 400) {
      return `Could not update test run status: ${apiMessage ?? "invalid status value or request body."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to update status for test run "${testRunId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
