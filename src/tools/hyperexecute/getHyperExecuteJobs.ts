import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapDataArray, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  limit: z.number().int().positive().optional(),
  // job_number-based, unlike the opaque string cursors on getJobScenarios/
  // getJobSessions - the value to resume from (exclusive; results start just
  // below it). Sending this automatically also sends is_cursor_base_pagination
  // to the API, since cursor otherwise has no effect there.
  cursor: z.number().int().optional(),
  show_test_summary: z.boolean().optional(),
};

// Same JSON-encoded-array-string handling as getHyperExecuteJobById.ts's
// formatJobLabel - duplicated rather than shared across tool files, matching
// this project's one-file-per-tool convention.
function formatJobLabel(value: unknown): string {
  const raw = readString(value);
  if (!raw) {
    return "N/A";
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return (parsed as string[]).join(" › ");
    }
  } catch {
    // fall through to raw string below
  }

  return raw;
}

function formatJobSummary(job: UnknownRecord, index: number): string {
  const meta = job.meta as UnknownRecord | undefined;
  const runId = readString(meta?.runId);

  const lines = [
    `${index + 1}. Job ${readString(job.id) ?? "N/A"} (#${readNumber(job.job_number) ?? "N/A"})`,
    `   Status: ${readString(job.status)?.toUpperCase() ?? "N/A"}`,
    `   Label: ${formatJobLabel(job.job_label)}`,
  ];

  // `meta.runId` - when present - is the originating Test Manager test_run_id.
  // Not every job has this (non-KaneAI-triggered jobs often don't), so it's
  // only shown when actually available rather than cluttering every entry
  // with "Test Manager Run ID: N/A".
  if (runId) {
    lines.push(`   Test Manager Run ID: ${runId}`);
  }

  lines.push(
    `   Remark: ${readString(job.remark) ?? "N/A"}`,
    `   Tasks: ${readNumber(job.Tasks) ?? "N/A"} | Total Tests: ${readNumber(job.total_tests) ?? "N/A"}`,
    `   Triggered By: ${readString(job.user) ?? "N/A"} (${readString(job.user_email) ?? "N/A"}) | Source: ${readString(job.trigger_source) ?? "N/A"}`,
    `   Created At: ${readString(job.created_at) ?? "N/A"} | Updated At: ${readString(job.update_at) ?? "N/A"}`,
    `   Execution Time: ${readString(job.executionTime) ?? "N/A"}`,
  );

  return lines.join("\n");
}

export function registerGetHyperExecuteJobsTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_hyperExecuteJobs",
    {
      title: "List HyperExecute Jobs",
      description:
        "Lists every HyperExecute Job in the organization (not scoped to one specific job), " +
        "newest first: job ID, job number, status, label, remark, task/test counts, who triggered " +
        "it and how, timestamps, and execution time. When a job carries it, also shows its " +
        "originating Test Manager test_run_id (from the job's meta.runId field) - the way to find " +
        "which HyperExecute job corresponds to a known Test Manager test run. Not every job has " +
        "this link (only KaneAI/Test-Manager-triggered jobs reliably do).\n" +
        "Input: limit (page size, default 10, no documented hard maximum), cursor (a job_number to " +
        "resume just below - from a previous response's 'Next Cursor' hint), show_test_summary " +
        "(request the job_summary field - has returned null on every job observed so far, may not " +
        "be populated for all job types).\n" +
        "IMPORTANT: there is no way to filter or search directly by test_run_id/label server-side - " +
        "finding a specific run's job means paging through results and checking each one's Test " +
        "Manager Run ID. This can require checking many pages for an older run, since job numbers " +
        "are not contiguous per organization. Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ limit, cursor, show_test_summary }) => {
      try {
        const response = await client.get(endpoints.hyperexecute.listJobs, {
          params: {
            limit,
            show_test_summary,
            // is_cursor_base_pagination has no effect unless a cursor is also
            // sent, and cursor has no effect without it - always paired.
            ...(cursor !== undefined ? { cursor, is_cursor_base_pagination: "true" } : {}),
          },
        });
        const jobs = unwrapDataArray(response);
        const metadata = (response as UnknownRecord | undefined)?.metadata as UnknownRecord | undefined;

        const lines = ["HyperExecute Jobs", ""];

        if (jobs.length === 0) {
          lines.push("(no jobs found)");
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        lines.push(jobs.map(formatJobSummary).join("\n\n"));

        const lastJobNumber = readNumber(jobs[jobs.length - 1]?.job_number);
        // `metadata` (and its `hasmore` flag) is only ever returned when cursor
        // pagination was used - a plain first-page call returns none at all, so
        // this falls back to a "the page was full, there may be more" heuristic
        // in that case rather than asserting hasmore either way.
        const hasMore = metadata ? metadata.hasmore === true : jobs.length === (limit ?? 10);

        if (hasMore && lastJobNumber !== undefined) {
          lines.push("", `Next Cursor: ${lastJobNumber} (pass as cursor to fetch the next page)`);
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
    const apiMessage = (error.response?.data as { error?: string; message?: string } | undefined)?.error;

    return `HyperExecute API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to list HyperExecute jobs: ${error instanceof Error ? error.message : "Unknown error"}`;
}
