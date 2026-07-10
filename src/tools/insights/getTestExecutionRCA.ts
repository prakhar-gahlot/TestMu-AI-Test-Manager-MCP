import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, type UnknownRecord } from "../../utils/response.js";

const idArray = z.array(z.string().trim().min(1)).optional();

const inputSchema = {
  test_ids: idArray,
  job_ids: idArray,
  task_ids: idArray,
  stage_ids: idArray,
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

type Input = {
  test_ids?: string[];
  job_ids?: string[];
  task_ids?: string[];
  stage_ids?: string[];
  page?: number;
  limit?: number;
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatStepsToFix(steps: unknown): string[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }

  const lines = ["", "  Steps to Fix:"];
  steps.forEach((step, index) => {
    const record = step as UnknownRecord;
    lines.push(
      `  ${index + 1}. Issue: ${readString(record.issue) ?? "N/A"}`,
      `     Module: ${readString(record.module) ?? "N/A"}`,
      `     Suggested Fix: ${readString(record.suggested_fix) ?? "N/A"}`,
    );
  });
  return lines;
}

function formatErrorTimeline(timeline: unknown): string[] {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return [];
  }

  const lines = ["", "  Error Timeline:"];
  timeline.forEach((entry, index) => {
    const record = entry as UnknownRecord;
    const stackTrace = readString(record.stack_trace);
    lines.push(
      `  ${index + 1}. ${readString(record.step_name) ?? "N/A"} (${readString(record.timestamp) ?? "N/A"})`,
      `     ${readString(record.summary) ?? "N/A"}`,
      `     Source: ${readString(record.source_log) ?? "N/A"}`,
    );
    if (stackTrace) {
      lines.push(`     Stack Trace: ${stackTrace}`);
    }
  });
  return lines;
}

function formatRCARecord(record: UnknownRecord, index: number): string {
  const detail = (record.rca_detail as UnknownRecord | undefined) ?? {};
  const analysis = readStringArray(detail.analysis);
  const stackTrace = readString(detail.stack_trace);
  // Two distinct fields observed live, not just one - `root_cause_stack_trace`
  // is NOT in the documented spec at all (only root_cause_failure_stack_trace
  // is); shown separately since they aren't guaranteed to always match.
  const rootCauseStackTrace = readString(detail.root_cause_stack_trace);
  const rootCauseFailureStackTrace = readString(detail.root_cause_failure_stack_trace);

  const lines = [
    `${index + 1}. Test ID: ${readString(record.test_id) ?? "N/A"}`,
    `   Job ID: ${readString(record.job_id) ?? "N/A"}`,
    `   Task ID: ${readString(record.task_id) ?? "N/A"}`,
    `   Stage ID: ${readString(record.stage_id) ?? "N/A"}`,
    `   Build ID: ${readString(record.build_id) ?? "N/A"}`,
    `   RCA Category: ${readString(record.rca_category) ?? "N/A"}`,
    `   Created: ${readString(record.create_timestamp) ?? "N/A"}`,
    `   Root Cause Category: ${readString(detail.root_cause_category) ?? "N/A"}`,
    `   Parent Failure Category: ${readString(detail.parent_failure_category) ?? "N/A"}`,
    `   Summary: ${readString(detail.failure_summary) ?? "N/A"}`,
  ];

  if (analysis.length > 0) {
    lines.push("", "  Analysis:", ...analysis.map((point) => `  - ${point}`));
  }

  lines.push(...formatErrorTimeline(detail.error_timeline));
  lines.push(...formatStepsToFix(detail.steps_to_fix));

  if (stackTrace) {
    lines.push("", `  Stack Trace: ${stackTrace}`);
  }
  if (rootCauseStackTrace) {
    lines.push(`  Root Cause Stack Trace: ${rootCauseStackTrace}`);
  }
  if (rootCauseFailureStackTrace && rootCauseFailureStackTrace !== rootCauseStackTrace) {
    lines.push(`  Root Cause Failure Stack Trace: ${rootCauseFailureStackTrace}`);
  }

  return lines.join("\n");
}

function formatPaginationFooter(pagination: UnknownRecord | undefined): string | undefined {
  const total = readNumber(pagination?.total);
  const page = readNumber(pagination?.page);
  const limit = readNumber(pagination?.limit);

  if (total === undefined || page === undefined || limit === undefined || limit === 0) {
    return undefined;
  }

  const lastPage = Math.max(1, Math.ceil(total / limit));
  return `Showing page ${page} of ${lastPage} (${total} total record${total === 1 ? "" : "s"}).`;
}

export function registerGetTestExecutionRCATool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testExecutionRCA",
    {
      title: "Get AI Root Cause Analysis for Test Executions",
      description:
        "Retrieves LambdaTest's AI-generated root cause analysis (RCA) for one or more " +
        "automation/KaneAI test executions. Accepts any combination of test_ids (the same ID " +
        "shown as 'Automation Test ID'/`test_id` by tm.get_testCaseInstancesByTestRunId, " +
        "tm.get_testExecutionHistoryByTestCaseId, and tm.get_hyperExecuteJobSessions), job_ids " +
        "(returns RCA for EVERY test execution in that HyperExecute job), task_ids (every " +
        "execution on that Task), or stage_ids - at least one of the four is required, each as an " +
        "array (multiple values batch-fetch in a single call). Optional page/limit for pagination " +
        "over large result sets.\n" +
        "Each record includes the RCA itself (category, severity-equivalent root cause/parent " +
        "failure category, natural-language summary and analysis, a step-by-step error timeline " +
        "with source logs and stack traces where available, and suggested steps to fix) AND that " +
        "execution's own job_id/task_id/stage_id/build_id - useful even without needing " +
        "tm.get_hyperExecuteTestDetails separately.\n" +
        "IMPORTANT: RCA only exists for an execution that BOTH actually ran AND failed - a passed " +
        "execution, an instance that never executed at all, and a wholly invalid ID of any type " +
        "all return an empty result (not an error), so an empty result here does not necessarily " +
        "mean an ID was wrong. Only query for executions already known to have failed (e.g. status " +
        "FAILED on a test case instance that also has a non-empty Automation Test ID / Test URL, " +
        "confirming it actually reached a session). Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ test_ids, job_ids, task_ids, stage_ids, page, limit }: Input) => {
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

        const response = await client.get(endpoints.insights.getRCA, {
          params: {
            test_ids: test_ids?.join(","),
            job_ids: job_ids?.join(","),
            task_ids: task_ids?.join(","),
            stage_ids: stage_ids?.join(","),
            page,
            limit,
          },
        });
        const records = Array.isArray((response as UnknownRecord)?.data)
          ? ((response as UnknownRecord).data as UnknownRecord[])
          : [];

        if (records.length === 0) {
          return {
            content: [
              {
                type: "text",
                text:
                  "No RCA found for the given ID(s). This means one of: the execution(s) passed " +
                  "(RCA is only generated for failures), never actually reached a session, or the " +
                  "ID(s) provided don't exist - this endpoint returns the same empty result for all " +
                  "three, so it cannot tell you which.",
              },
            ],
          };
        }

        const footer = formatPaginationFooter((response as UnknownRecord)?.pagination as UnknownRecord | undefined);
        const text = records.map(formatRCARecord).join("\n\n") + (footer ? `\n\n${footer}` : "");

        return { content: [{ type: "text", text }] };
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

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve RCA: ${error instanceof Error ? error.message : "Unknown error"}`;
}
