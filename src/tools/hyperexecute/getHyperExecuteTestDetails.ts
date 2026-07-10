import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  automation_test_id: z.string().trim().min(1, "automation_test_id is required"),
};

function formatTestDetails(automationTestId: string, details: UnknownRecord): string {
  const remark = readString(details.remark);
  const name = readString(details.name);
  const sessionId = readString(details.session_id);

  return [
    `HyperExecute Test Execution "${automationTestId}"`,
    `Status: ${readString(details.status_v)?.toUpperCase() ?? "N/A"}`,
    `Job ID: ${readString(details.job) ?? "N/A"}`,
    `Task ID: ${readString(details.task) ?? "N/A"}`,
    `Stage ID: ${readString(details.stage_id) ?? "N/A"}`,
    `Step: ${readString(details.step) ?? "N/A"} | Retry: ${readString(details.retry) ?? "N/A"}`,
    `SmartUI Enabled: ${details.smartui_enabled === true ? "Yes" : "No"}`,
    `Session ID: ${sessionId || "(none)"}`,
    `Name: ${name || "(none)"}`,
    `Remark: ${remark || "N/A"}`,
    `Created: ${readString(details.created) ?? "N/A"}`,
    `Updated: ${readString(details.updated) ?? "N/A"}`,
  ].join("\n");
}

export function registerGetHyperExecuteTestDetailsTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_hyperExecuteTestDetails",
    {
      title: "Get HyperExecute Test Execution Details",
      description:
        "Retrieves one specific automation test execution's HyperExecute routing details by its " +
        "automation_test_id (the same ID shown as 'Automation Test ID'/`test_id` by " +
        "tm.get_testCaseInstancesByTestRunId, tm.get_testExecutionHistoryByTestCaseId, " +
        "tm.get_testExecutionRCA, and as sessionID/testID by tm.get_hyperExecuteJobSessions). " +
        "Returns its status, Job ID, Task ID, Stage ID, step/retry number, and session ID.\n" +
        "THIS IS THE RECOMMENDED WAY to find which HyperExecute Job (tm.get_hyperExecuteJobById) an " +
        "execution belongs to, when you already have an automation_test_id - fast and reliable, " +
        "including for scheduled Test Manager runs. It requires the automation_test_id to already " +
        "be known (from one of the tools above), and that instance must have actually reached a " +
        "session (an instance that failed before a session was created has no automation_test_id at " +
        "all, so there is nothing to look up here). Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ automation_test_id }) => {
      try {
        const response = await client.get(endpoints.hyperexecute.getTestDetails(automation_test_id));
        const details = unwrapData(response);

        if (!readString(details?.job)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `No HyperExecute job found for automation test "${automation_test_id}" (unexpected empty response).`,
              },
            ],
          };
        }

        return { content: [{ type: "text", text: formatTestDetails(automation_test_id, details) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, automation_test_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, automationTestId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { error?: string } | undefined)?.error;

    if (status === 404) {
      return `No HyperExecute test execution found for automation test ID "${automationTestId}"${apiMessage ? `: ${apiMessage}` : "."}`;
    }

    return `HyperExecute API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve HyperExecute test execution details for "${automationTestId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
