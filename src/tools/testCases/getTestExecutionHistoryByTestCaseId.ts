import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapData, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  test_case_id: z.string().trim().min(1, "test_case_id is required"),
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

function formatExecution(execution: UnknownRecord, index: number): string {
  // This endpoint does not return a URL field itself - unlike
  // tm.get_testCaseInstancesByTestRunId, whose linked_test_url field showed
  // this exact pattern, so it's built here from automation_test_id rather
  // than read from the API. automation_test_id is also the ID LambdaTest's
  // RCA endpoint (GET https://api.lambdatest.com/insights/api/v3/rca/{id})
  // keys off, for automation/KaneAI executions.
  const automationTestId = readString(execution.automation_test_id);
  const constructedTestUrl = automationTestId
    ? `https://automation.lambdatest.com/test?testID=${automationTestId}`
    : undefined;

  const lines = [
    `${index + 1}. Status: ${readString(execution.status)?.toUpperCase() ?? "N/A"}`,
    `   Test Run: ${readString(execution.test_run_name) ?? "N/A"} (ID: ${readString(execution.test_run_id) ?? "N/A"})`,
    `   Test Type: ${readString(execution.test_type) ?? "N/A"}`,
    `   Framework: ${readString(execution.framework) ?? "N/A"}`,
    `   Start: ${readString(execution.start_time) ?? "N/A"}`,
    `   End: ${readString(execution.end_time) ?? "N/A"}`,
    `   Environment: ${formatEnvironment(execution.config)}`,
    `   Automation Test ID: ${automationTestId ?? "N/A"}`,
  ];

  if (constructedTestUrl) {
    lines.push(`   Test URL (constructed): ${constructedTestUrl}`);
  }

  lines.push(`   Executed By (User ID): ${readNumber(execution.executed_by) ?? "N/A"}`);

  return lines.join("\n");
}

// The response wraps its list in a nested envelope
// (`{ data: { data: [...], executed_executions_count, planned_executions_count, status_values } }`),
// unlike other list endpoints in this API that put the array directly under
// `data`. `unwrapData` peels off the outer envelope; the inner `data` array
// and the execution counts are then read directly off what's left.
function formatHistory(testCaseId: string, envelope: UnknownRecord): string {
  const executions = Array.isArray(envelope.data) ? (envelope.data as UnknownRecord[]) : [];
  const executedCount = readNumber(envelope.executed_executions_count);
  const plannedCount = readNumber(envelope.planned_executions_count);

  const lines = [
    `Test Execution History for Test Case "${testCaseId}"`,
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

export function registerGetTestExecutionHistoryByTestCaseIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testExecutionHistoryByTestCaseId",
    {
      title: "Get Test Manager Test Execution History by Test Case ID",
      description:
        "Retrieves the execution history of a LambdaTest Test Manager test case by its exact test " +
        "case ID: every recorded run's status (passed/failed/skipped/etc.), the test run it belonged " +
        "to, start/end time, framework, test type (automation/manual), browser/OS/device environment, " +
        "and automation test ID, plus overall executed/planned execution counts. Use this to inspect " +
        "how a test case has performed over time.\n" +
        "AUTOMATION TEST ID / RCA: for automation/KaneAI executions, automation_test_id is the ID " +
        "LambdaTest's other services key off - a Test URL is shown (constructed from the same " +
        "https://automation.lambdatest.com/test?testID={id} pattern this API itself uses elsewhere, " +
        "since this endpoint does not return a URL field directly) and the same ID can be passed to " +
        "LambdaTest's AI root-cause-analysis endpoint " +
        "(https://api.lambdatest.com/insights/api/v3/rca/{automation_test_id}) for a failure's root " +
        "cause, steps to fix, and error timeline. planned_executions_count is NOT scoped to any " +
        "single test run - it aggregates across every run/schedule that has ever referenced this test " +
        "case - so a gap versus executed_executions_count does not indicate anything about a specific " +
        "run's own instances. Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ test_case_id }) => {
      try {
        const response = await client.get(endpoints.executionHistory.getByTestCaseId(test_case_id));
        const envelope = unwrapData(response);

        return {
          content: [{ type: "text", text: formatHistory(test_case_id, envelope) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, test_case_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, testCaseId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422) {
      return `Could not retrieve execution history: ${apiMessage ?? `invalid test case ID "${testCaseId}".`}`;
    }

    if (status === 404) {
      return `Test case not found: no test case exists with ID "${testCaseId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve execution history for test case "${testCaseId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
