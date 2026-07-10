import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, readTagNames, unwrapData, type UnknownRecord } from "../../utils/response.js";

// Omitting environment_id causes the API to assign this exact placeholder
// ("No config selected") - a global/account-wide default, not
// project-specific. Baked in here (rather than left omitted) so that
// matching an entry against an already-existing default-environment row is
// deterministic.
const DEFAULT_ENVIRONMENT_ID = 5;

// `environment_id` is optional and, if omitted, safely defaults to
// DEFAULT_ENVIRONMENT_ID. DO NOT guess a different environment_id: passing
// one that doesn't exist does NOT return an error - it corrupts the run's
// stored data so badly that every subsequent read of the run
// (tm.get_testRunById, tm.get_testCaseInstancesByTestRunId, etc.) starts
// failing with a 500 "index out of range" server error, requiring another
// update to repair. Only pass an environment_id you've confirmed exists,
// e.g. one seen in an existing instance's environment `id` field via
// tm.get_testRunById.
const testCaseEntrySchema = z.object({
  test_case_id: z.string().trim().min(1, "test_case_id is required"),
  environment_id: z.number().int().positive().optional(),
  assignee: z.number().int().optional(),
  priority: z.string().trim().optional(),
});

const inputSchema = {
  test_run_id: z.string().trim().min(1, "test_run_id is required"),
  test_cases: z.array(testCaseEntrySchema).min(1, "at least one test case is required"),
};

type TestCaseEntry = z.infer<typeof testCaseEntrySchema>;

// One row per (test_case_id, environment) pairing, matching the API's PUT
// shape exactly.
type TestRunInstanceRow = {
  test_case_id: string;
  environment_id: number;
  assignee?: number;
  priority?: string;
  serial_no: number;
};

function rowKey(testCaseId: string, environmentId: number): string {
  return `${testCaseId}::${environmentId}`;
}

// The PUT replaces test_run_instances wholesale - a PUT that omits an
// existing test case silently drops it from the run - so every existing
// (test_case_id, environment) pairing must be flattened back into rows and
// included alongside the new/updated ones, or they'd be deleted. Keyed by
// rowKey so new entries can be matched against them.
function flattenExistingInstances(instances: UnknownRecord[]): Map<string, TestRunInstanceRow> {
  const rows = new Map<string, TestRunInstanceRow>();

  for (const instance of instances) {
    const testCaseId = readString(instance.test_case_id);
    if (!testCaseId) continue;

    const environments = Array.isArray(instance.environment) ? (instance.environment as UnknownRecord[]) : [];
    const assignee = readNumber(instance.assignee);
    const priority = readString(instance.priority);

    for (const env of environments) {
      const environmentId = readNumber(env.id) ?? DEFAULT_ENVIRONMENT_ID;
      rows.set(rowKey(testCaseId, environmentId), { test_case_id: testCaseId, environment_id: environmentId, assignee, priority, serial_no: 0 });
    }
  }

  return rows;
}

function formatResult(
  testRunId: string,
  added: TestCaseEntry[],
  updated: TestCaseEntry[],
  unchanged: TestCaseEntry[],
): string {
  const lines = [
    `Test Run "${testRunId}" Updated Successfully`,
    `Test Cases Added: ${added.length}`,
    `Test Cases Updated: ${updated.length}`,
  ];

  const describeEntry = (entry: TestCaseEntry): string =>
    `- ${entry.test_case_id}` +
    ` (environment_id: ${entry.environment_id ?? DEFAULT_ENVIRONMENT_ID})` +
    (entry.assignee !== undefined ? `, assignee: ${entry.assignee}` : "") +
    (entry.priority ? `, priority: ${entry.priority}` : "");

  if (added.length > 0) {
    lines.push(...added.map(describeEntry));
  }
  if (updated.length > 0) {
    lines.push(...updated.map(describeEntry));
  }
  if (unchanged.length > 0) {
    lines.push(`No change (already matched): ${unchanged.map((entry) => entry.test_case_id).join(", ")}`);
  }

  return lines.join("\n");
}

export function registerAddTestCasesToTestRunTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.add_testCasesToTestRun",
    {
      title: "Add or Update Test Cases in a Test Manager Test Run",
      description:
        "Adds one or more test cases (each optionally with an environment_id, assignee user ID - see " +
        "tm.get_organizationUsers to look one up - and priority) to an existing LambdaTest Test " +
        "Manager test run, WITHOUT removing test cases already in the run. If a test case is already " +
        "in the run with the same environment_id, this UPDATES its assignee/priority instead of " +
        "adding a duplicate - so it's also how you reassign or reprioritize an existing test case " +
        "instance, not just add new ones. Internally fetches the run's current test cases first and " +
        "PUTs the complete merged list back, since the underlying API replaces the run's entire test " +
        "case list on every update - calling this repeatedly is safe. A test case can be present " +
        "multiple times with different environment_id values to run it against multiple " +
        "environments. environment_id/assignee/priority are all optional per test case - omitting " +
        "environment_id defaults to a placeholder 'No config selected' environment. " +
        "Get a valid environment_id from tm.get_environments (or read one off an existing test-run " +
        "instance via tm.get_testRunById). DANGER: only ever pass an environment_id from one of those " +
        "two sources - a nonexistent environment_id does NOT return an error, it corrupts the run so " +
        "badly that every subsequent read of it (tm.get_testRunById, tm.get_testCaseInstancesByTestRunId) " +
        "starts failing with a 500 server error until repaired by another update. Do not call this " +
        "speculatively - it's a real, persistent action.\n" +
        "KANEAI RUNS: works on both manual and KaneAI test runs (see tm.create_testRun's " +
        "is_auteur_generated input for creating one), but every test case passed in must match the " +
        "run's own type - refuses the entire call (no partial changes) if any test case's own " +
        "is_auteur_generated does not match the run's. Manual test cases cannot enter a KaneAI run and " +
        "vice versa. This is NOT the same thing as the run's is_editable flag, which reflects KaneAI " +
        "schedule ownership, not manual/KaneAI compatibility.",
      inputSchema,
    },
    async ({ test_run_id, test_cases }) => {
      try {
        const currentResponse = await client.get(endpoints.testRuns.getById(test_run_id));
        const current = unwrapData(currentResponse);

        if (!readString(current?.id)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test run not found: no test run exists with ID "${test_run_id}".` }],
          };
        }

        // Manual and KaneAI test cases must match the run's own is_auteur_generated flag - the API
        // does not enforce this itself (confirmed live: it accepts a mismatched write with no
        // error), so every test case being added/updated is checked against the run's type here.
        // is_editable is NOT used for this check - it reflects KaneAI schedule ownership of the
        // run, not manual/KaneAI compatibility (a one-off, unscheduled KaneAI run reads is_editable:
        // true despite still being a KaneAI run).
        const runIsAuteurGenerated = current.is_auteur_generated === true;
        const uniqueTestCaseIds = [...new Set(test_cases.map((entry) => entry.test_case_id))];

        const testCaseChecks = await Promise.all(
          uniqueTestCaseIds.map(async (testCaseId) => {
            try {
              const response = await client.get(endpoints.testCases.getById(testCaseId));
              const testCase = unwrapData(response);
              return {
                testCaseId,
                isAuteurGenerated: testCase.is_auteur_generated === true,
                found: readString(testCase?.title) !== undefined,
              };
            } catch {
              return { testCaseId, isAuteurGenerated: false, found: false };
            }
          }),
        );

        const mismatched = testCaseChecks.filter(
          (check) => check.found && check.isAuteurGenerated !== runIsAuteurGenerated,
        );

        if (mismatched.length > 0) {
          const runKind = runIsAuteurGenerated ? "a KaneAI test run" : "a manual test run";
          const mismatchKind = runIsAuteurGenerated ? "manual" : "KaneAI";
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `Test run "${test_run_id}" is ${runKind}. The following test case(s) are ${mismatchKind} ` +
                  `and cannot be added to it: ${mismatched.map((m) => m.testCaseId).join(", ")}. ` +
                  "Manual and KaneAI test cases/runs are not interchangeable. No changes were made.",
              },
            ],
          };
        }

        const existingInstances = Array.isArray(current.instances) ? (current.instances as UnknownRecord[]) : [];
        const rows = flattenExistingInstances(existingInstances);

        const added: TestCaseEntry[] = [];
        const updated: TestCaseEntry[] = [];
        const unchanged: TestCaseEntry[] = [];

        for (const entry of test_cases) {
          const environmentId = entry.environment_id ?? DEFAULT_ENVIRONMENT_ID;
          const key = rowKey(entry.test_case_id, environmentId);
          const existingRow = rows.get(key);

          if (!existingRow) {
            rows.set(key, {
              test_case_id: entry.test_case_id,
              environment_id: environmentId,
              assignee: entry.assignee,
              priority: entry.priority,
              serial_no: 0,
            });
            added.push(entry);
            continue;
          }

          const nextAssignee = entry.assignee ?? existingRow.assignee;
          const nextPriority = entry.priority ?? existingRow.priority;
          const changed = nextAssignee !== existingRow.assignee || nextPriority !== existingRow.priority;

          rows.set(key, { ...existingRow, assignee: nextAssignee, priority: nextPriority });
          (changed ? updated : unchanged).push(entry);
        }

        const allRows = [...rows.values()].map((row, index) => ({ ...row, serial_no: index + 1 }));

        const body = {
          id: test_run_id,
          title: readString(current.title) ?? "",
          objective: readString(current.objective) ?? "",
          tags: readTagNames(current.tags),
          is_auteur_generated: current.is_auteur_generated === true,
          type: readString(current.type) ?? "Manual",
          test_run_instances: allRows,
          project_id: readString(current.project_id) ?? "",
        };

        const response = await client.put(endpoints.testRuns.update(test_run_id), body);
        const result = unwrapData(response);

        if (readString(result?.type) !== "Success") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not update test run "${test_run_id}": ${readString(result?.message) ?? "unexpected response from the API."}`,
              },
            ],
          };
        }

        return { content: [{ type: "text", text: formatResult(test_run_id, added, updated, unchanged) }] };
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
    const rawMessage = (error.response?.data as { message?: unknown } | undefined)?.message;
    const apiMessage = typeof rawMessage === "string" ? rawMessage : rawMessage ? JSON.stringify(rawMessage) : undefined;

    if (status === 422 || status === 404) {
      return `Test run not found: ${apiMessage ?? `no test run exists with ID "${testRunId}".`}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to update test run "${testRunId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
