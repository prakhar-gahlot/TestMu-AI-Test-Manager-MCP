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
  include_detail: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
};

type Input = {
  test_ids?: string[];
  job_ids?: string[];
  task_ids?: string[];
  stage_ids?: string[];
  include_detail?: boolean;
  limit?: number;
  offset?: number;
};

// Same rca_detail shape and formatting as tm.get_testExecutionRCA - duplicated
// here rather than shared across tool files, matching this project's
// one-file-per-tool convention.
function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatStepsToFix(steps: unknown): string[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }

  const lines = ["", "   Steps to Fix:"];
  steps.forEach((step, index) => {
    const record = step as UnknownRecord;
    lines.push(
      `   ${index + 1}. Issue: ${readString(record.issue) ?? "N/A"}`,
      `      Module: ${readString(record.module) ?? "N/A"}`,
      `      Suggested Fix: ${readString(record.suggested_fix) ?? "N/A"}`,
    );
  });
  return lines;
}

function formatErrorTimeline(timeline: unknown): string[] {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return [];
  }

  const lines = ["", "   Error Timeline:"];
  timeline.forEach((entry, index) => {
    const record = entry as UnknownRecord;
    const stackTrace = readString(record.stack_trace);
    lines.push(
      `   ${index + 1}. ${readString(record.step_name) ?? "N/A"} (${readString(record.timestamp) ?? "N/A"})`,
      `      ${readString(record.summary) ?? "N/A"}`,
      `      Source: ${readString(record.source_log) ?? "N/A"}`,
    );
    if (stackTrace) {
      lines.push(`      Stack Trace: ${stackTrace}`);
    }
  });
  return lines;
}

function formatDetail(detail: UnknownRecord): string[] {
  const analysis = readStringArray(detail.analysis);
  const stackTrace = readString(detail.stack_trace);
  const rootCauseStackTrace = readString(detail.root_cause_stack_trace);
  const rootCauseFailureStackTrace = readString(detail.root_cause_failure_stack_trace);

  const lines = [`   Summary: ${readString(detail.failure_summary) ?? "N/A"}`];

  if (analysis.length > 0) {
    lines.push("", "   Analysis:", ...analysis.map((point) => `   - ${point}`));
  }

  lines.push(...formatErrorTimeline(detail.error_timeline));
  lines.push(...formatStepsToFix(detail.steps_to_fix));

  if (stackTrace) {
    lines.push("", `   Stack Trace: ${stackTrace}`);
  }
  if (rootCauseStackTrace) {
    lines.push(`   Root Cause Stack Trace: ${rootCauseStackTrace}`);
  }
  if (rootCauseFailureStackTrace && rootCauseFailureStackTrace !== rootCauseStackTrace) {
    lines.push(`   Root Cause Failure Stack Trace: ${rootCauseFailureStackTrace}`);
  }

  return lines;
}

function formatProgress(progress: UnknownRecord | undefined): string[] {
  return [
    "Progress:",
    `  Total Tests: ${readNumber(progress?.total_tests) ?? "N/A"}`,
    `  Completed: ${readNumber(progress?.completed) ?? "N/A"}`,
    `  In Progress: ${readNumber(progress?.in_progress) ?? "N/A"}`,
    `  Failed: ${readNumber(progress?.failed) ?? "N/A"}`,
    `  Pending: ${readNumber(progress?.pending) ?? "N/A"}`,
  ];
}

function formatResult(result: UnknownRecord, index: number): string {
  const detail = result.rca_detail as UnknownRecord | undefined;

  const lines = [
    `${index + 1}. Test ID: ${readString(result.test_id) ?? "N/A"}`,
    `   Job ID: ${readString(result.job_id) ?? "N/A"}`,
    `   Task ID: ${readString(result.task_id) ?? "N/A"}`,
    `   Stage ID: ${readString(result.stage_id) ?? "N/A"}`,
    `   Status: ${readString(result.status) ?? "N/A"}`,
    `   RCA Category: ${readString(result.rca_category) ?? "N/A"}`,
    `   Parent Failure Category: ${readString(result.parent_failure_category) || "N/A"}`,
    `   Created: ${readString(result.created_at) ?? "N/A"}`,
  ];

  if (detail) {
    lines.push(...formatDetail(detail));
  }

  return lines.join("\n");
}

function formatPaginationFooter(pagination: UnknownRecord | undefined): string | undefined {
  const total = readNumber(pagination?.total);
  const limit = readNumber(pagination?.limit);
  const offset = readNumber(pagination?.offset);

  if (total === undefined || limit === undefined || offset === undefined) {
    return undefined;
  }

  const shown = Math.min(limit, Math.max(0, total - offset));
  return `Showing records ${offset + 1}-${offset + shown} of ${total} total.`;
}

export function registerGetTestExecutionRCAStatusTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testExecutionRCAStatus",
    {
      title: "Get RCA Generation Progress and Results",
      description:
        "Returns a progress summary (total/completed/in_progress/failed/pending counts) plus a " +
        "paginated list of completed RCA results for a scope - the tool to poll with after " +
        "calling tm.generate_testExecutionRCA, since generation is asynchronous. Accepts the same " +
        "scope as tm.generate_testExecutionRCA/tm.get_testExecutionRCA: any combination of " +
        "test_ids, job_ids, task_ids, or stage_ids (at least one required, each array capped at " +
        "100 IDs).\n" +
        "Pass include_detail: true to hydrate each result with the full RCA detail (analysis, " +
        "error timeline, steps to fix, stack traces - same content as tm.get_testExecutionRCA) - " +
        "omitted by default to keep polling calls small. Supports limit/offset pagination over " +
        "the results list (NOTE: offset-based, unlike tm.get_testExecutionRCA's page-based " +
        "pagination - a real difference between these two otherwise-similar endpoints).\n" +
        "A scope matching zero tests (wrong IDs, IDs with no failures, etc.) still returns a " +
        "normal result with all-zero progress counts rather than an error - this tool surfaces the " +
        "API's own explanatory message in that case. Read-only; does not modify anything (does " +
        "NOT trigger generation itself - use tm.generate_testExecutionRCA for that).",
      inputSchema,
    },
    async ({ test_ids, job_ids, task_ids, stage_ids, include_detail, limit, offset }: Input) => {
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

        const response = await client.get(endpoints.insights.getRCAStatus, {
          params: {
            test_ids: test_ids?.join(","),
            job_ids: job_ids?.join(","),
            task_ids: task_ids?.join(","),
            stage_ids: stage_ids?.join(","),
            include_detail,
            limit,
            offset,
          },
        });
        const data = unwrapData(response);
        const progress = data?.progress as UnknownRecord | undefined;
        const results = Array.isArray(data?.results) ? (data.results as UnknownRecord[]) : [];

        const lines = [...formatProgress(progress), ""];

        if (results.length === 0) {
          const apiMessage = readString((response as UnknownRecord)?.message);
          lines.push(apiMessage ?? "No completed RCA results yet for this scope.");
        } else {
          lines.push(results.map(formatResult).join("\n\n"));
          const footer = formatPaginationFooter(data?.pagination as UnknownRecord | undefined);
          if (footer) {
            lines.push("", footer);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
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

    if (status === 413) {
      return `Scope too large (resolves to more than 10,000 tests) - narrow the scope and try again. ${apiMessage ?? ""}`.trim();
    }

    if (status === 403) {
      return `Forbidden: AI capability may not be enabled for this organization, or the caller is a guest user. ${apiMessage ?? ""}`.trim();
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve RCA status: ${error instanceof Error ? error.message : "Unknown error"}`;
}
