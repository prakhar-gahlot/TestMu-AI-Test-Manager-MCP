import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// Distinct from tm.update_testCaseInstance (one instance per call) and
// tm.add_testCasesToTestRun (whole-run replace) - this updates MULTIPLE
// existing instances, each independently, in a single call. Each instance is
// identified by its own numeric id (from tm.get_testCaseInstancesByTestRunId's
// 'Instance ID' field), same ID tm.update_testCaseInstance and
// tm.get_testCaseInstanceById use.
//
// Only status/assignee are exposed here (unlike tm.update_testCaseInstance's
// four fields) - environment_id and remarks were tried and confirmed to be
// silently no-ops on THIS endpoint specifically, despite working on the
// single-instance PUT.
//
// DANGER, confirmed live: including `status` on an entry resets ALL of that
// instance's steps to "Skipped" - regardless of which status value is sent
// (even "Passed") - discarding whatever real per-step results were already
// there. Omitting `status` (e.g. an assignee-only update) leaves steps
// untouched. The single-instance PUT (tm.update_testCaseInstance) does NOT
// have this side effect.
const instanceUpdateSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    status: z.enum(["Not Started", "Passed", "Failed", "Skipped"]).optional(),
    assignee: z.number().int().optional(),
  })
  .refine((entry) => entry.status !== undefined || entry.assignee !== undefined, {
    message: "each instance needs at least one of status or assignee",
  });

const inputSchema = {
  test_run_id: z.string().trim().min(1, "test_run_id is required"),
  instances: z.array(instanceUpdateSchema).min(1, "at least one instance is required"),
};

export function registerBulkUpdateTestCaseInstancesTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.bulkUpdate_testCaseInstances",
    {
      title: "Bulk Update Test Manager Test Case Instances",
      description:
        "Updates MULTIPLE test case instances within one test run in a single call - each instance " +
        "independently gets its own status (Not Started/Passed/Failed/Skipped) and/or assignee (user " +
        "ID - see tm.get_organizationUsers to look one up), identified by its own numeric id (from " +
        "tm.get_testCaseInstancesByTestRunId's 'Instance ID' field). Use this instead of calling " +
        "tm.update_testCaseInstance repeatedly when updating several instances in the same run at " +
        "once. Each instance needs at least one of status or assignee. environment_id and remarks are " +
        "NOT supported here (confirmed silently ignored) even though tm.update_testCaseInstance " +
        "supports both - use that tool instead for those fields. " +
        "DANGER: including `status` on an instance resets ALL of that instance's steps to 'Skipped' " +
        "- regardless of which status value is sent, even 'Passed' - discarding any real per-step " +
        "results already recorded via tm.update_testCaseInstanceStep. If per-step results must be " +
        "preserved, either omit status here (assignee-only) or re-apply per-step statuses afterward. " +
        "Do not call this speculatively - it's a real, persistent action.",
      inputSchema,
    },
    async ({ test_run_id, instances }) => {
      const body = {
        test_run_instances: instances.map(({ id, status, assignee }) => {
          const entry: Record<string, unknown> = { id };
          if (status !== undefined) entry.status = status;
          if (assignee !== undefined) entry.assignee = assignee;
          return entry;
        }),
      };

      try {
        const response = await client.put(endpoints.testRuns.bulkUpdateInstances(test_run_id), body);
        const result = unwrapData(response);

        if (readString(result?.type) !== "Success") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not bulk-update test run "${test_run_id}": ${
                  readString(result?.message) ?? "unexpected response from the API."
                }`,
              },
            ],
          };
        }

        const ids = instances.map((entry) => entry.id).join(", ");
        return {
          content: [{ type: "text", text: `Updated ${instances.length} instance(s) in test run "${test_run_id}": ${ids}.` }],
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
    const rawMessage = (error.response?.data as { message?: unknown } | undefined)?.message;
    const apiMessage = typeof rawMessage === "string"
      ? rawMessage
      : Array.isArray(rawMessage)
        ? rawMessage.map((entry) => (entry && typeof entry === "object" ? (entry as { detail?: string }).detail : entry)).join("; ")
        : rawMessage
          ? JSON.stringify(rawMessage)
          : undefined;

    if (status === 422) {
      return `Could not bulk-update test run "${testRunId}": ${apiMessage ?? "the request was invalid, or one of the instance IDs doesn't belong to this run."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to bulk-update test run "${testRunId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
