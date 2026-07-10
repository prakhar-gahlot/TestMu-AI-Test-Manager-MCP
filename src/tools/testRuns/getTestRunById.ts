import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, readTagNames, unwrapData, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  test_run_id: z.string().trim().min(1, "test_run_id is required"),
};

// Each environment is one browser/OS/device configuration the test case runs
// against within this run. `name` is the environment's own label (e.g. a
// saved config name), separate from the browser/OS details.
function formatEnvironment(env: UnknownRecord): string {
  const browser = readString(env.browser);
  const browserVersion = readString(env.browser_version);
  const os = readString(env.os) ?? readString(env.os_name);
  const osVersion = readString(env.os_version);

  const parts = [
    browser && `${browser}${browserVersion ? ` ${browserVersion}` : ""}`,
    os && `${os}${osVersion && osVersion !== os ? ` (${osVersion})` : ""}`,
    readString(env.resolution),
    readString(env.platform),
  ].filter((part): part is string => Boolean(part));

  const label = readString(env.name);
  const assignee = readNumber(env.assignee);

  return (
    `${label ? `${label}: ` : ""}${parts.length > 0 ? parts.join(", ") : "N/A"}` +
    (assignee !== undefined ? ` (assignee: ${assignee})` : "")
  );
}

// Each instance is one test case in the run, with the set of environments it
// runs against. `status` here is the test case's own review status (e.g.
// Unverified/Live), NOT a pass/fail execution outcome - this endpoint
// doesn't expose per-execution results, only what's planned to run.
function formatInstance(instance: UnknownRecord, index: number): string {
  const environments = Array.isArray(instance.environment) ? (instance.environment as UnknownRecord[]) : [];

  const lines = [
    `${index + 1}. ${readString(instance.title) ?? "N/A"} (Test Case ID: ${readString(instance.test_case_id) ?? "N/A"})`,
    `   Internal ID: ${readString(instance.internal_id) ?? "N/A"}`,
    `   Priority: ${readString(instance.priority) ?? "N/A"}`,
    `   Status: ${readString(instance.status) ?? "N/A"}`,
    `   Automation Status: ${readString(instance.automation_status) ?? "N/A"}`,
    `   Assignee (User ID): ${readNumber(instance.assignee) ?? "N/A"}`,
    `   Environments (${environments.length}):`,
  ];

  if (environments.length === 0) {
    lines.push("   - (none)");
  } else {
    lines.push(...environments.map((env) => `   - ${formatEnvironment(env)}`));
  }

  return lines.join("\n");
}

// The response is flat (no `data` envelope), unlike most other Test Manager
// endpoints - `unwrapData` still works here since it falls back to the raw
// record when there's no `.data` field to unwrap.
function formatTestRun(testRun: UnknownRecord): string {
  const instances = Array.isArray(testRun.instances) ? (testRun.instances as UnknownRecord[]) : [];
  const tags = readTagNames(testRun.tags);

  // Computed directly from the instances list rather than trusted from the
  // API's own total_test_cases/total_environments fields, which are both
  // just duplicates of total_run_instances on this endpoint (see comment
  // below) - counting distinct environment `id`s ourselves gives the real
  // number.
  const uniqueEnvironmentIds = new Set<unknown>();
  for (const instance of instances) {
    const environments = Array.isArray(instance.environment) ? (instance.environment as UnknownRecord[]) : [];
    for (const env of environments) {
      uniqueEnvironmentIds.add(env.id);
    }
  }

  const lines = [
    `Test Run: ${readString(testRun.title) ?? "N/A"} (ID: ${readString(testRun.id) ?? "N/A"})`,
    `Objective: ${readString(testRun.objective) ?? "N/A"}`,
    `Project ID: ${readString(testRun.project_id) ?? "N/A"}`,
    `Status: ${readString(testRun.status) ?? "N/A"}`,
    `Type: ${readString(testRun.type) ?? "N/A"}`,
    `Build State: ${readString(testRun.build_state) ?? "N/A"}`,
    `Sequential: ${testRun.is_sequential === true ? "Yes" : "No"}`,
    `Build Disabled: ${testRun.is_build_disabled === true ? "Yes" : "No"}`,
    `Auteur Generated: ${testRun.is_auteur_generated === true ? "Yes" : "No"}`,
    "Tags:",
    ...(tags.length > 0 ? tags.map((tag) => `- ${tag}`) : ["- (none)"]),
    `Created At: ${readString(testRun.created_at) ?? "N/A"} (by user ${readNumber(testRun.created_by) ?? "N/A"})`,
    `Updated At: ${readString(testRun.updated_at) ?? "N/A"} (by user ${readNumber(testRun.updated_by) ?? "N/A"})`,
    // The API's own total_test_cases/total_environments/total_run_instances
    // fields are all the SAME number (test-case x environment combos), not
    // three distinct counts as their names imply. This tool deliberately
    // ignores total_test_cases/total_environments and computes the true
    // distinct counts itself below, so the numbers shown here ARE correct.
    `Test Cases (distinct): ${instances.length}`,
    `Environments (distinct): ${uniqueEnvironmentIds.size}`,
    `Total Test Case Instances (test case x environment pairings, NOT unique test count): ${readNumber(testRun.total_run_instances) ?? "N/A"}`,
    "",
  ];

  if (instances.length === 0) {
    lines.push("(no test cases in this run)");
  } else {
    lines.push("Test Cases in Run:", "", instances.map(formatInstance).join("\n\n"));
  }

  return lines.join("\n");
}

export function registerGetTestRunByIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testRunById",
    {
      title: "Get Test Manager Test Run by ID",
      description:
        "Retrieves a LambdaTest Test Manager test run by its exact ID: title, objective, status, type " +
        "(Manual/Automation), build state, tags, and every test case included in the run along with " +
        "the environment(s) (browser/OS/device/resolution) each one is set to run against. Note: this " +
        "does not include per-execution pass/fail results - the `status` shown per test case is its " +
        "own review status, not an execution outcome; use tm.get_testExecutionHistoryByTestCaseId for " +
        "actual run history.\n" +
        "TERMINOLOGY: a 'test case instance' is ONE (test case x environment) pairing, not one test " +
        "case. If a single test case is assigned 2 environments in this run, that is 2 instances, not " +
        "1 - the count of unique test cases in a run is virtually always smaller than the instance " +
        "count.\n" +
        "KNOWN API QUIRK (already corrected in this tool's output, for awareness only): the LambdaTest " +
        "API's own total_test_cases/total_environments/total_run_instances fields on this endpoint are " +
        "ALL THE SAME underlying number (the instance count) despite their distinct-sounding names. " +
        "This tool does NOT trust those fields - the 'Test Cases (distinct)' and 'Environments " +
        "(distinct)' figures shown below are computed directly from the instance list instead, so they " +
        "ARE genuinely correct. tm.get_testRunsByProjectId independently reports correct distinct " +
        "figures too (via different, non-quirky fields), so the two tools' numbers should agree for the " +
        "same run - if they ever don't, that's worth flagging as a bug, not expected behavior. Read-only; " +
        "does not modify anything.",
      inputSchema,
    },
    async ({ test_run_id }) => {
      try {
        const response = await client.get(endpoints.testRuns.getById(test_run_id));
        const testRun = unwrapData(response);

        if (!readString(testRun?.id)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test run not found: no test run exists with ID "${test_run_id}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatTestRun(testRun) }],
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

    if (status === 422) {
      return `Test run not found: ${apiMessage ?? `no test run exists with ID "${testRunId}".`}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test run "${testRunId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
