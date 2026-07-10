import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// This endpoint isn't in LambdaTest's published OpenAPI docs beyond a bare
// status/assignee example - sourced from the browser network inspector,
// including that it also accepts environment_id and remarks. It updates only
// the fields provided, leaving the rest of the instance (and the rest of the
// run) untouched - unlike tm.add_testCasesToTestRun, which must replace the
// run's entire test case list on every call.
const inputSchema = {
  test_instance_id: z.coerce.string().trim().min(1, "test_instance_id is required"),
  status: z.enum(["Not Started", "Passed", "Failed", "Skipped"]).optional(),
  assignee: z.number().int().optional(),
  environment_id: z.number().int().positive().optional(),
  remarks: z.string().optional(),
};

export function registerUpdateTestCaseInstanceTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.update_testCaseInstance",
    {
      title: "Update a Test Manager Test Case Instance",
      description:
        "Updates one or more of a single test case instance's own fields - status " +
        "(Not Started/Passed/Failed/Skipped), assignee (user ID - see tm.get_organizationUsers to " +
        "look one up), environment_id, and/or remarks - identified by its numeric test_instance_id " +
        "(get it from tm.get_testCaseInstancesByTestRunId's 'Instance ID' field). Only the fields " +
        "provided are changed; everything else about the instance, and every other instance in the " +
        "run, is left untouched. Requires at least one field to change. " +
        "Get a valid environment_id from tm.get_environments (or read one off an existing test-run " +
        "instance via tm.get_testRunById). DANGER: only ever pass an environment_id from one of those " +
        "two sources - a nonexistent environment_id does NOT return an error, it corrupts the run so " +
        "badly that every subsequent read of it (tm.get_testRunById, tm.get_testCaseInstancesByTestRunId) " +
        "starts failing with a 500 server error until repaired by another update. Do not call this " +
        "speculatively - it's a real, persistent action.",
      inputSchema,
    },
    async ({ test_instance_id, status, assignee, environment_id, remarks }) => {
      const body: Record<string, unknown> = {};
      if (status !== undefined) body.status = status;
      if (assignee !== undefined) body.assignee = assignee;
      if (environment_id !== undefined) body.environment_id = environment_id;
      if (remarks !== undefined) body.remarks = remarks;

      if (Object.keys(body).length === 0) {
        return {
          isError: true,
          content: [
            { type: "text", text: "No changes provided: pass at least one of status, assignee, environment_id, or remarks." },
          ],
        };
      }

      try {
        const response = await client.put(endpoints.testRuns.updateInstance(test_instance_id), body);
        const result = unwrapData(response);

        if (readString(result?.type) !== "Success") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not update test case instance "${test_instance_id}": ${
                  readString(result?.message) ?? "unexpected response from the API."
                }`,
              },
            ],
          };
        }

        const changedFields = Object.keys(body).join(", ");
        return {
          content: [{ type: "text", text: `Test case instance "${test_instance_id}" updated (${changedFields}).` }],
        };
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
    const rawMessage = (error.response?.data as { message?: unknown } | undefined)?.message;
    // Seen shapes for `message`: a plain string, and an array of
    // { key, detail } objects for some 400s - handle both.
    const apiMessage = typeof rawMessage === "string"
      ? rawMessage
      : Array.isArray(rawMessage)
        ? rawMessage.map((entry) => (entry && typeof entry === "object" ? (entry as { detail?: string }).detail : entry)).join("; ")
        : rawMessage
          ? JSON.stringify(rawMessage)
          : undefined;

    if (status === 403) {
      return (
        `Could not update test case instance "${testInstanceId}": ${apiMessage ?? "not allowed."} This endpoint ` +
        "returns 403 for a nonexistent instance ID (rather than 404/422), but it can also mean a genuine " +
        "permissions issue - double-check the ID first."
      );
    }

    if (status === 422) {
      return `Could not update test case instance "${testInstanceId}": ${apiMessage ?? "the request was invalid."}`;
    }

    if (status === 400) {
      return `Could not update test case instance: "${testInstanceId}" is not a valid instance ID, or the request body was invalid (${apiMessage ?? "bad request"}).`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to update test case instance "${testInstanceId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
