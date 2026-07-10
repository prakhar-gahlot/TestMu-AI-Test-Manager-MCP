import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapData, type UnknownRecord } from "../../utils/response.js";

const idArray = z.array(z.string().trim().min(1)).max(100, "each array is capped at 100 IDs").optional();

const inputSchema = {
  test_ids: idArray,
  job_ids: idArray,
  task_ids: idArray,
  stage_ids: idArray,
};

type Input = {
  test_ids?: string[];
  job_ids?: string[];
  task_ids?: string[];
  stage_ids?: string[];
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatResult(result: UnknownRecord): string {
  const triggeredIds = readStringArray(result.test_ids);
  const skippedIds = readStringArray(result.skipped_test_ids);

  const lines = [
    "RCA Generation Dispatched",
    `Total Failed Tests in Scope: ${readNumber(result.total_tests) ?? "N/A"}`,
    `Newly Triggered: ${readNumber(result.triggered_count) ?? "N/A"}`,
    `Skipped: ${readNumber(result.skipped_count) ?? "N/A"} (already generated: ${readNumber(result.skipped_already_generated) ?? "N/A"}, in progress: ${readNumber(result.skipped_in_progress) ?? "N/A"})`,
    `Credits Estimated: ${readNumber(result.credits_estimated) ?? "N/A"}`,
  ];

  if (triggeredIds.length > 0) {
    lines.push("", "Newly Triggered Test IDs:", ...triggeredIds.map((id) => `- ${id}`));
  }
  if (skippedIds.length > 0) {
    lines.push("", "Skipped Test IDs (already generated or in progress):", ...skippedIds.map((id) => `- ${id}`));
  }

  return lines.join("\n");
}

export function registerGenerateTestExecutionRCATool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.generate_testExecutionRCA",
    {
      title: "Trigger AI Root Cause Analysis Generation",
      description:
        "Dispatches AI-powered RCA generation for every failed test under the given scope: any " +
        "combination of job_ids, stage_ids, task_ids, or test_ids (at least one required, each " +
        "array capped at 100 IDs). Jobs/stages/tasks always route to the HyperExecute analyzer; " +
        "test_ids route to the correct analyzer automatically per test, so a mixed batch is fine. " +
        "A test whose RCA already exists or is currently generating is skipped automatically and " +
        "not charged - only newly-dispatched tests cost credits, so it is safe to pass a broad " +
        "scope (e.g. an entire job) without first checking which tests already have RCA. Returns " +
        "how many were newly triggered vs. skipped (and why), and the estimated credits used.\n" +
        "DANGER: this spends REAL organizational AI credits and cannot be undone - do not call " +
        "speculatively or on a broad scope 'just to see'. Credits are all-or-nothing: if the " +
        "organization's balance is insufficient for the whole scope, NOTHING is dispatched (a 402 " +
        "is returned instead) rather than partially triggering. A scope resolving to more than " +
        "10,000 failed tests is rejected (413) - narrow it first. Use tm.get_testExecutionRCA " +
        "beforehand to check whether RCA already exists for the tests you care about, and confirm " +
        "with the user before calling this on anything but a small, deliberately-chosen scope.",
      inputSchema,
    },
    async ({ test_ids, job_ids, task_ids, stage_ids }: Input) => {
      try {
        if (!test_ids?.length && !job_ids?.length && !task_ids?.length && !stage_ids?.length) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "At least one of test_ids, job_ids, task_ids, or stage_ids is required.",
              },
            ],
          };
        }

        const body: UnknownRecord = {};
        if (test_ids?.length) body.test_ids = test_ids;
        if (job_ids?.length) body.job_ids = job_ids;
        if (task_ids?.length) body.task_ids = task_ids;
        if (stage_ids?.length) body.stage_ids = stage_ids;

        const response = await client.post(endpoints.insights.generateRCA, body);
        const result = unwrapData(response);

        return { content: [{ type: "text", text: formatResult(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 402) {
      return `Insufficient credits - no tests were dispatched. ${apiMessage ?? "Check the organization's AI credit balance."}`;
    }

    if (status === 413) {
      return `Scope too large (resolves to more than 10,000 failed tests) - narrow the scope and try again. ${apiMessage ?? ""}`.trim();
    }

    if (status === 403) {
      return `Forbidden: AI capability may not be enabled for this organization, or the caller is a guest user. ${apiMessage ?? ""}`.trim();
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to trigger RCA generation: ${error instanceof Error ? error.message : "Unknown error"}`;
}
