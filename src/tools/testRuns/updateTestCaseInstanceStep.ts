import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// This endpoint isn't in LambdaTest's published OpenAPI docs beyond a bare
// status/remarks/attachment_urls example - sourced from the browser network
// inspector. It updates only the ONE step identified by test_run_step_id,
// leaving every other step on the same instance (and the instance's own
// overall `result`) untouched - marking every step Passed does NOT
// automatically roll the instance's own result up to Passed; that must be
// set separately via tm.update_testCaseInstance.
//
// attachment_urls confirmed live: despite the name, it expects each entry to
// be a file_key (from tm.upload_attachment's response), not a URL. A
// file_key correctly attaches the file (readable back via
// tm.get_testCaseInstanceById, with a freshly re-signed URL each read); a
// raw URL string is silently accepted (200 Success) but has no effect.
const inputSchema = {
  test_run_step_id: z.coerce.string().trim().min(1, "test_run_step_id is required"),
  status: z.enum(["Not Started", "Passed", "Failed", "Skipped"]).optional(),
  remarks: z.string().optional(),
  attachment_urls: z.array(z.string()).optional(),
};

export function registerUpdateTestCaseInstanceStepTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.update_testCaseInstanceStep",
    {
      title: "Update a Test Manager Test Case Instance Step",
      description:
        "Updates ONE step's own status (Not Started/Passed/Failed/Skipped), remarks, and/or " +
        "attachment_urls within a single test case instance, identified by the step's own numeric " +
        "test_run_step_id (get it from tm.get_testCaseInstanceById's 'Step ID' field on each step - " +
        "NOT the instance ID itself). Only the fields provided are changed; every other step on the " +
        "same instance is untouched. IMPORTANT: updating step statuses does NOT automatically roll up " +
        "to the instance's own overall result - set that separately with tm.update_testCaseInstance " +
        "if needed. attachment_urls, despite the name, must contain file_key values from " +
        "tm.upload_attachment (upload the file first, then pass its file_key here) - a raw URL is " +
        "silently accepted but has no effect. Requires at least one field to change. Do not call this " +
        "speculatively - it's a real, persistent action.",
      inputSchema,
    },
    async ({ test_run_step_id, status, remarks, attachment_urls }) => {
      const body: Record<string, unknown> = {};
      if (status !== undefined) body.status = status;
      if (remarks !== undefined) body.remarks = remarks;
      if (attachment_urls !== undefined) body.attachment_urls = attachment_urls;

      if (Object.keys(body).length === 0) {
        return {
          isError: true,
          content: [
            { type: "text", text: "No changes provided: pass at least one of status, remarks, or attachment_urls." },
          ],
        };
      }

      try {
        const response = await client.put(endpoints.testRuns.updateStep(test_run_step_id), body);
        const result = unwrapData(response);

        if (readString(result?.type) !== "Success") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not update test run step "${test_run_step_id}": ${
                  readString(result?.message) ?? "unexpected response from the API."
                }`,
              },
            ],
          };
        }

        const changedFields = Object.keys(body).join(", ");
        return {
          content: [{ type: "text", text: `Test run step "${test_run_step_id}" updated (${changedFields}).` }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, test_run_step_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, testRunStepId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const rawMessage = (error.response?.data as { message?: unknown } | undefined)?.message;
    const apiMessage = typeof rawMessage === "string" ? rawMessage : rawMessage ? JSON.stringify(rawMessage) : undefined;

    if (status === 403) {
      return (
        `Could not update test run step "${testRunStepId}": ${apiMessage ?? "not authorized."} This endpoint ` +
        "returns 403 for both a malformed and a nonexistent step ID (rather than 400/404/422), but it can " +
        "also mean a genuine permissions issue - double-check the ID first."
      );
    }

    if (status === 422) {
      return `Could not update test run step "${testRunStepId}": ${apiMessage ?? "the request was invalid."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to update test run step "${testRunStepId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
