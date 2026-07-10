import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, readTagNames, unwrapData, type UnknownRecord } from "../../utils/response.js";

// test_instance_id is numeric server-side (e.g. 123456789) - distinct from
// test_case_id, which is a ULID string. z.coerce.string() accepts either a
// JSON number or a string from the caller and normalizes it before .trim().
const inputSchema = {
  test_instance_id: z.coerce.string().trim().min(1, "test_instance_id is required"),
};

function formatEnvironment(env: unknown): string {
  const record = env as UnknownRecord | undefined;
  const browser = readString(record?.browser);
  const browserVersion = readString(record?.browser_version);
  const os = readString(record?.os) ?? readString(record?.os_name);
  const osVersion = readString(record?.os_version);

  const parts = [
    browser && `${browser}${browserVersion ? ` ${browserVersion}` : ""}`,
    os && `${os}${osVersion && osVersion !== os ? ` (${osVersion})` : ""}`,
    readString(record?.resolution),
    readString(record?.device),
    readString(record?.platform),
  ].filter((part): part is string => Boolean(part));

  const label = readString(record?.name);
  return `${label ? `${label}: ` : ""}${parts.length > 0 ? parts.join(", ") : "N/A"}`;
}

// Unlike tm.get_testCaseInstancesByTestRunId (which only gives one overall
// `status` per instance), this endpoint exposes per-step results via
// `test_build_steps` - each step's own status/outcome/remarks/timing, not
// just the instance-wide result. Each step's own `id` (Step ID) is required
// to update it via tm.update_testCaseInstanceStep.
function formatTestStep(step: UnknownRecord, index: number): string {
  const remarks = readString(step.remarks);
  const lines = [
    `   ${index + 1}. [${readString(step.status)?.toUpperCase() ?? "N/A"}] ${readString(step.description) ?? "N/A"} (Step ID: ${readString(step.id) ?? "N/A"})`,
    `      Expected Outcome: ${readString(step.outcome) ?? "N/A"}`,
  ];
  if (remarks) {
    lines.push(`      Remarks: ${remarks}`);
  }
  return lines.join("\n");
}

function formatInstance(instance: UnknownRecord): string {
  const tagNames = readTagNames(instance.tags);
  const remarks = readString(instance.remarks);
  const bugCount = readNumber(instance.bug_count);
  const steps = Array.isArray(instance.test_build_steps) ? (instance.test_build_steps as UnknownRecord[]) : [];

  const lines = [
    `Test Case Instance: ${readString(instance.title) ?? "N/A"} (Instance ID: ${readNumber(instance.id) ?? "N/A"})`,
    `Test Run: ${readString(instance.test_run_title) ?? "N/A"} (ID: ${readString(instance.test_run_id) ?? "N/A"})`,
    `Test Case ID: ${readString(instance.test_case_id) ?? "N/A"}`,
    `Project ID: ${readString(instance.project_id) ?? "N/A"}`,
    `Internal ID: ${readString(instance.internal_id) ?? "N/A"}`,
    `Description: ${readString(instance.description) ?? "N/A"}`,
    `Priority: ${readString(instance.priority) ?? "N/A"}`,
    `Type: ${readString(instance.type) ?? "N/A"}`,
    `Source: ${readString(instance.source) ?? "N/A"}`,
    `Order No: ${readNumber(instance.order_no) ?? "N/A"}`,
    "",
    // `result` is this specific instance's own outcome within this run -
    // marking it here does NOT change the underlying test case's stored
    // status in Test Manager; that only happens via tm.update_testCase.
    `Result: ${readString(instance.result)?.toUpperCase() ?? "N/A"}`,
    `Automation Status: ${readString(instance.automation_status) ?? "N/A"}`,
    `Executed By (User ID): ${readNumber(instance.executed_by) ?? "N/A"}`,
    `Assignee (User ID): ${readNumber(instance.assignee) ?? "N/A"}`,
    `Started At: ${readString(instance.started_at) ?? "N/A"}`,
    `Ended At: ${readString(instance.ended_at) ?? "N/A"}`,
    `Time Taken: ${readString(instance.time_taken) ?? "N/A"}`,
    `Remarks: ${remarks ?? "N/A"}`,
    `Run Disabled: ${instance.run_testcase_disable === true ? "Yes" : "No"}`,
  ];

  if (bugCount !== undefined && bugCount > 0) {
    lines.push(`Linked Bugs: ${bugCount}`);
  }

  lines.push("", `Environment: ${formatEnvironment(instance.environment)}`);
  lines.push("", `Tags: ${tagNames.length > 0 ? tagNames.join(", ") : "(none)"}`);

  lines.push("", `Test Steps (${readNumber(instance.test_steps_count) ?? steps.length}):`);
  if (steps.length === 0) {
    lines.push("   (none)");
  } else {
    lines.push(...steps.map((step, index) => formatTestStep(step, index)));
  }

  return lines.join("\n");
}

export function registerGetTestCaseInstanceByIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testCaseInstanceById",
    {
      title: "Get Test Manager Test Case Instance by ID",
      description:
        "Retrieves full detail for ONE specific test case instance, identified by its own numeric " +
        "test_instance_id (NOT the same as test_case_id - get it from " +
        "tm.get_testCaseInstancesByTestRunId's 'Instance ID' field). TERMINOLOGY: a 'test case " +
        "instance' is ONE (test case x environment) pairing within a run, not one test case - if a " +
        "test case is assigned 2 environments in the same run, each environment has its own separate " +
        "instance ID and its own separate result here. Includes the instance's own result " +
        "(Passed/Failed/Skipped/Not Started), timing, remarks, environment, and per-step results (each " +
        "step's own status/outcome/remarks, plus its own Step ID for use with " +
        "tm.update_testCaseInstanceStep) - detail that tm.get_testCaseInstancesByTestRunId doesn't " +
        "expose. Setting/inspecting this instance's result only affects its standing within this run - " +
        "it does NOT change the underlying test case's own stored status in Test Manager. Read-only; " +
        "does not modify anything.",
      inputSchema,
    },
    async ({ test_instance_id }) => {
      try {
        const response = await client.get(endpoints.testRuns.getInstanceById(test_instance_id));
        const instance = unwrapData(response);

        if (!readNumber(instance?.id) && !readString(instance?.id)) {
          return {
            isError: true,
            content: [
              { type: "text", text: `Test case instance not found: no instance exists with ID "${test_instance_id}".` },
            ],
          };
        }

        return { content: [{ type: "text", text: formatInstance(instance) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, test_instance_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, testInstanceId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 400) {
      return `Could not retrieve test case instance: "${testInstanceId}" is not a valid instance ID (${apiMessage ?? "must be numeric"}).`;
    }

    if (status === 403) {
      return (
        `Could not retrieve test case instance "${testInstanceId}": ${apiMessage ?? "not allowed."} This endpoint ` +
        "returns 403 for a nonexistent instance ID (rather than 404/422), but it can also mean a genuine " +
        "permissions issue - double-check the ID first."
      );
    }

    if (status === 422 || status === 404) {
      return `Test case instance not found: ${apiMessage ?? `no instance exists with ID "${testInstanceId}".`}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test case instance "${testInstanceId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
