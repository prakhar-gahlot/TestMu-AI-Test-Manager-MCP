import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import {
  formatPaginationFooter,
  readNumber,
  readString,
  readTagNames,
  unwrapDataArray,
  type UnknownRecord,
} from "../../utils/response.js";

// `status` matches the run's filterMetadata.status options (Not Started /
// Passed / Failed / Skipped); `assignee` is a user ID, same as the
// `assignee` field on each instance.
const inputSchema = {
  test_run_id: z.string().trim().min(1, "test_run_id is required"),
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().optional(),
  status: z.string().trim().optional(),
  assignee: z.number().int().optional(),
};

// Unlike tm.get_testRunById (which nests all of a test case's assigned
// environments under one entry), each row here is already one specific
// test-case+environment combo, with its own real execution status - this is
// the endpoint that answers "what actually happened", not "what's planned".
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

function formatInstance(instance: UnknownRecord, index: number): string {
  const tagNames = readTagNames(instance.tags);
  const remarks = readString(instance.remarks);
  const bugCount = readNumber(instance.bug_count);
  // `test_id` here is the automation test's own ID (only present for
  // automation/KaneAI instances) - it's what LambdaTest's other services
  // (RCA, automation logs, video) key off, distinct from test_case_id and
  // from the instance's own numeric `id`. `linked_test_url` is a direct link
  // to that same execution on the LambdaTest automation dashboard.
  const automationTestId = readString(instance.test_id);
  const linkedTestUrl = readString(instance.linked_test_url);

  const lines = [
    `${index + 1}. ${readString(instance.title) ?? "N/A"} (Test Case ID: ${readString(instance.test_case_id) ?? "N/A"})`,
    // This numeric `id` is the test_instance_id - distinct from test_case_id
    // and required to look up per-step results via tm.get_testCaseInstanceById.
    `   Instance ID: ${readNumber(instance.id) ?? "N/A"}`,
    `   Status: ${readString(instance.status)?.toUpperCase() ?? "N/A"}`,
    `   Priority: ${readString(instance.priority) ?? "N/A"}`,
    `   Automation Status: ${readString(instance.automation_status) ?? "N/A"}`,
    `   Assignee (User ID): ${readNumber(instance.assignee) ?? "N/A"}`,
    `   Environment: ${formatEnvironment(instance.environment)}`,
    `   Internal ID: ${readString(instance.internal_id) ?? "N/A"}`,
  ];

  if (automationTestId) {
    lines.push(`   Automation Test ID: ${automationTestId}`);
  }
  if (linkedTestUrl) {
    lines.push(`   Test URL: ${linkedTestUrl}`);
  }
  if (tagNames.length > 0) {
    lines.push(`   Tags: ${tagNames.join(", ")}`);
  }
  if (remarks) {
    lines.push(`   Remarks: ${remarks}`);
  }
  if (bugCount !== undefined && bugCount > 0) {
    lines.push(`   Linked Bugs: ${bugCount}`);
  }

  return lines.join("\n");
}

// `run_result` is the actual pass/fail/skipped/not-started breakdown for the
// whole run - the summary that tm.get_testRunById cannot provide since it
// only shows planned composition, not outcomes.
function formatRunSummary(details: UnknownRecord): string {
  const tagNames = readTagNames(details.tags);
  const runResult = details.run_result as UnknownRecord | undefined;

  const lines = [
    `Test Run: ${readString(details.title) ?? "N/A"} (ID: ${readString(details.id) ?? "N/A"})`,
    `Objective: ${readString(details.objective) ?? "N/A"}`,
    `Project ID: ${readString(details.project_id) ?? "N/A"}`,
    `Status: ${readString(details.status) ?? "N/A"}`,
    `Type: ${readString(details.type) ?? "N/A"}`,
    `Build State: ${readString(details.build_state) ?? "N/A"}`,
    `Build Disabled: ${details.is_build_disabled === true ? "Yes" : "No"}`,
    `Tags: ${tagNames.length > 0 ? tagNames.join(", ") : "(none)"}`,
    `Created At: ${readString(details.created_at) ?? "N/A"} (by user ${readNumber(details.created_by) ?? "N/A"})`,
    `Updated At: ${readString(details.updated_at) ?? "N/A"} (by user ${readNumber(details.updated_by) ?? "N/A"})`,
    "Run Result:",
    `  Total: ${readNumber(runResult?.total_test) ?? "N/A"}`,
    `  Passed: ${readNumber(runResult?.passed) ?? "N/A"}`,
    `  Failed: ${readNumber(runResult?.failed) ?? "N/A"}`,
    `  Skipped: ${readNumber(runResult?.skipped) ?? "N/A"}`,
    `  Not Started: ${readNumber(runResult?.not_started) ?? "N/A"}`,
  ];

  const bugCount = readNumber(details.bug_count);
  if (bugCount !== undefined && bugCount > 0) {
    lines.push(`Linked Bugs (run-wide): ${bugCount}`);
  }

  return lines.join("\n");
}

export function registerGetTestCaseInstancesByTestRunIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testCaseInstancesByTestRunId",
    {
      title: "Get Test Manager Test Case Instances by Test Run ID",
      description:
        "Retrieves the actual execution results for a LambdaTest Test Manager test run: a run-wide " +
        "pass/failed/skipped/not-started breakdown, plus one entry per test case instance with its " +
        "real execution status, assignee, remarks, and linked bug count. TERMINOLOGY: each entry is " +
        "ONE (test case x environment) pairing, not one unique test case - a test case assigned 2 " +
        "environments in this run produces 2 separate entries here, each with its own independent " +
        "result. Unlike tm.get_testRunById (which shows planned composition only), this shows what " +
        "actually happened. For automation/KaneAI instances, also surfaces the automation test's own " +
        "ID (distinct from test_case_id and from this entry's own instance ID) and a direct link to " +
        "that execution on the LambdaTest automation dashboard - the automation test ID is the key " +
        "other LambdaTest services (e.g. AI root-cause-analysis, execution logs, video) use to look up " +
        "that specific execution, not test_case_id or the instance ID. Supports pagination (page, " +
        "per_page) and filtering by status ('Not Started', 'Passed', 'Failed', 'Skipped') and/or " +
        "assignee (user ID). Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ test_run_id, page, per_page, status, assignee }) => {
      try {
        const response = await client.get(endpoints.testRuns.getInstancesById(test_run_id), {
          params: {
            page,
            per_page,
            "filter[status]": status,
            "filter[assignee]": assignee,
          },
        });
        const details = (response as UnknownRecord | undefined)?.test_run_details as UnknownRecord | undefined;

        if (!details || !readString(details.id)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test run not found: no test run exists with ID "${test_run_id}".` }],
          };
        }

        const testRunInstances = (response as UnknownRecord).test_run_instances;
        const instances = unwrapDataArray(testRunInstances);
        const footer = formatPaginationFooter(testRunInstances, "instance");

        const lines = [formatRunSummary(details), ""];

        if (instances.length === 0) {
          lines.push("(no instances match this query)");
        } else {
          lines.push("Instances:", "", instances.map(formatInstance).join("\n\n"));
          if (footer) {
            lines.push("", footer);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
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

    if (status === 400) {
      return `Could not retrieve test case instances: ${apiMessage ?? "invalid page, per_page, status, or assignee filter."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test case instances for "${testRunId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
