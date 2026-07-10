import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapData, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  jira_issue_id: z.string().trim().min(1, "jira_issue_id is required"),
};

// Config is per-execution environment info (browser/OS/device/resolution).
// Fields are frequently empty strings (e.g. `brand`/`device` for desktop
// browser runs) rather than absent, so blanks are filtered out instead of
// shown as "N/A" noise.
function formatEnvironment(value: unknown): string {
  const config = value as UnknownRecord | undefined;
  const parts = [
    readString(config?.browser) &&
      `${readString(config?.browser_version) ?? readString(config?.browser)}`,
    readString(config?.os) && `${readString(config?.os_version) ?? readString(config?.os)}`,
    readString(config?.device),
    readString(config?.resolution),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : "N/A";
}

// A Jira issue can be linked to multiple test cases (unlike the by-test-case
// history, which is scoped to one), so each entry shows which test case it
// came from.
function formatExecution(execution: UnknownRecord, index: number): string {
  const lines = [
    `${index + 1}. Test Case: ${readString(execution.title) ?? "N/A"} (ID: ${readString(execution.test_case_id) ?? "N/A"})`,
    `   Status: ${readString(execution.status)?.toUpperCase() ?? "N/A"}`,
    `   Test Run: ${readString(execution.test_run_name) ?? "N/A"} (ID: ${readString(execution.test_run_id) ?? "N/A"})`,
    `   Test Type: ${readString(execution.test_type) ?? "N/A"}`,
    `   Framework: ${readString(execution.framework) ?? "N/A"}`,
    `   Start: ${readString(execution.start_time) ?? "N/A"}`,
    `   End: ${readString(execution.end_time) ?? "N/A"}`,
    `   Environment: ${formatEnvironment(execution.config)}`,
    `   Automation Test ID: ${readString(execution.automation_test_id) ?? "N/A"}`,
    `   Executed By (User ID): ${readNumber(execution.executed_by) ?? "N/A"}`,
  ];

  return lines.join("\n");
}

// The response wraps its list in a nested envelope
// (`{ data: { data: [...], executed_executions_count, planned_executions_count, status_values } }`),
// same as the by-test-case-id history endpoint. A Jira ID with no linked
// executions returns `{ data: null }` (HTTP 200, not an error) - `data` is
// then read as `undefined` and simply renders as an empty history below.
function formatHistory(jiraIssueId: string, envelope: UnknownRecord): string {
  const executions = Array.isArray(envelope.data) ? (envelope.data as UnknownRecord[]) : [];
  const executedCount = readNumber(envelope.executed_executions_count);
  const plannedCount = readNumber(envelope.planned_executions_count);

  const lines = [
    `Test Execution History for Jira Issue "${jiraIssueId}"`,
    `Executed Executions: ${executedCount ?? executions.length}`,
    `Planned Executions: ${plannedCount ?? "N/A"}`,
    "",
  ];

  if (executions.length === 0) {
    lines.push("(no executions recorded)");
  } else {
    lines.push(executions.map(formatExecution).join("\n\n"));
  }

  return lines.join("\n");
}

export function registerGetTestExecutionHistoryByJiraIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testExecutionHistoryByJiraId",
    {
      title: "Get Test Manager Test Execution History by Jira ID",
      description:
        "Retrieves the execution history of every LambdaTest Test Manager test case linked to a given " +
        "Jira issue ID (e.g. 'PROJ-123'): each recorded run's status, which test case and test run it " +
        "belongs to, start/end time, framework, test type (automation/manual), browser/OS/device " +
        "environment, and automation test ID, plus overall executed/planned execution counts. Use " +
        "this to see how all test cases tied to a Jira ticket have performed. If the Jira ID has no " +
        "linked executions, returns an empty history rather than an error. Read-only; does not modify " +
        "anything.",
      inputSchema,
    },
    async ({ jira_issue_id }) => {
      try {
        const response = await client.get(endpoints.executionHistory.getByJiraId(jira_issue_id));
        const envelope = unwrapData(response);

        return {
          content: [{ type: "text", text: formatHistory(jira_issue_id, envelope) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, jira_issue_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, jiraIssueId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422) {
      return `Could not retrieve execution history: ${apiMessage ?? `invalid Jira issue ID "${jiraIssueId}".`}`;
    }

    if (status === 404) {
      return `No test cases found linked to Jira issue "${jiraIssueId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve execution history for Jira issue "${jiraIssueId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
