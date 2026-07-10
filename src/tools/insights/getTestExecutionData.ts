import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapDataArray, type UnknownRecord } from "../../utils/response.js";

const idArray = z.array(z.string().trim().min(1)).optional();

const inputSchema = {
  from_timestamp: z.string().trim().optional(),
  to_timestamp: z.string().trim().optional(),
  job_ids: idArray,
  task_ids: idArray,
  stage_ids: idArray,
  test_ids: idArray,
  build_ids: idArray,
  limit: z.number().int().positive().max(500, "limit cannot exceed 500").optional(),
  cursor: z.string().trim().optional(),
  sort_by: z.enum(["create_timestamp", "duration", "status"]).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
};

type Input = {
  from_timestamp?: string;
  to_timestamp?: string;
  job_ids?: string[];
  task_ids?: string[];
  stage_ids?: string[];
  test_ids?: string[];
  build_ids?: string[];
  limit?: number;
  cursor?: string;
  sort_by?: "create_timestamp" | "duration" | "status";
  sort_order?: "asc" | "desc";
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatEnvironment(env: UnknownRecord | undefined): string {
  const parts = [
    readString(env?.browser) &&
      `${readString(env?.browser)}${readString(env?.browser_version) ? ` ${readString(env?.browser_version)}` : ""}`,
    readString(env?.os) && `${readString(env?.os)}${readString(env?.os_version) ? ` ${readString(env?.os_version)}` : ""}`,
    readString(env?.device),
    readString(env?.resolution),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : "N/A";
}

function formatTest(record: UnknownRecord, index: number): string {
  const env = record.env_config as UnknownRecord | undefined;
  const meta = record.test_metadata as UnknownRecord | undefined;
  const build = record.build_metadata as UnknownRecord | undefined;
  const insights = record.insights as UnknownRecord | undefined;
  const smartTags = insights?.smart_tags as UnknownRecord | undefined;
  const flakiness = insights?.flakiness as UnknownRecord | undefined;
  const rca = insights?.rca as UnknownRecord | undefined;
  const tags = readStringArray(meta?.tags);
  const buildTags = readStringArray(build?.build_tags);

  const lines = [
    `${index + 1}. ${readString(meta?.test_name) ?? "N/A"} (Test ID: ${readString(record.test_id) ?? "N/A"})`,
    `   Status: ${readString(meta?.status)?.toUpperCase() ?? "N/A"} | Duration: ${readNumber(meta?.duration) ?? "N/A"}s`,
    `   Environment: ${formatEnvironment(env)}`,
    `   Created: ${readString(meta?.create_timestamp) ?? "N/A"} | Start: ${readString(meta?.start_timestamp) ?? "N/A"} | End: ${readString(meta?.end_timestamp) ?? "N/A"}`,
    `   Build: ${readString(build?.build_name) ?? "N/A"} (Build ID: ${readString(build?.build_id) ?? "N/A"})`,
    `   Job ID: ${readString(build?.job_id) ?? "N/A"} | Task ID: ${readString(build?.task_id) ?? "N/A"} | Stage ID: ${readString(build?.stage_id) ?? "N/A"}`,
    `   Smart Tags: Always Failing: ${smartTags?.is_always_failing === true ? "Yes" : "No"}, New Failure: ${smartTags?.is_new_failure === true ? "Yes" : "No"}, Flaky: ${smartTags?.is_flaky === true ? "Yes" : "No"}, Perf Anomaly: ${smartTags?.is_performance_anomaly === true ? "Yes" : "No"}`,
    `   Flakiness: ${flakiness?.is_flaky === true ? "Yes" : "No"} (rate: ${readNumber(flakiness?.flake_rate) ?? "N/A"})`,
    `   RCA Category: ${readString(rca?.category) ?? "N/A"}${readString(rca?.summary) ? ` - ${readString(rca?.summary)}` : ""}`,
    `   Failure Category: ${readString(insights?.failure_category) ?? "N/A"}`,
  ];

  if (tags.length > 0) {
    lines.push(`   Tags: ${tags.join(", ")}`);
  }
  if (buildTags.length > 0) {
    lines.push(`   Build Tags: ${buildTags.join(", ")}`);
  }

  return lines.join("\n");
}

function formatFooter(response: UnknownRecord): string[] {
  const pagination = response.pagination as UnknownRecord | undefined;
  const notes = readStringArray(response.notes);
  const lines: string[] = [];

  if (pagination?.has_more === true) {
    lines.push(`More results available - pass cursor: "${readString(pagination.next_cursor) ?? ""}" to fetch the next page.`);
  }
  if (notes.length > 0) {
    lines.push(...notes.map((note) => `Note: ${note}`));
  }

  return lines;
}

export function registerGetTestExecutionDataTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testExecutionData",
    {
      title: "Get Test Execution Data with AI Insights",
      description:
        "Retrieves paginated test execution records enriched with AI insights: smart tags (always " +
        "failing / new failure / flaky / performance anomaly), flakiness rate, a condensed RCA " +
        "(category + summary - use tm.get_testExecutionRCA for the full detail), failure category, " +
        "environment (browser/OS/device/resolution), test timing, and build/job/task/stage IDs.\n" +
        "Filters: any combination of job_ids, task_ids, stage_ids, test_ids, build_ids (the TOTAL " +
        "ID count across all five combined is capped at 100, unlike the RCA endpoints which cap " +
        "each array separately). Defaults to the last 7 days if from_timestamp/to_timestamp are " +
        "both omitted - THIS STILL APPLIES even when filtering by a specific test_id, so a real, " +
        "valid test_id from more than 7 days ago returns an empty result unless the date range is " +
        "widened explicitly (both timestamps must be RFC3339 UTC, supplied together - one alone is " +
        "rejected - and span at most 31 days per call). Supports cursor-based pagination " +
        "(cursor/limit, max 500) and sorting (sort_by: create_timestamp/duration/status, " +
        "sort_order: asc/desc). Read-only; does not modify anything.",
      inputSchema,
    },
    async ({
      from_timestamp,
      to_timestamp,
      job_ids,
      task_ids,
      stage_ids,
      test_ids,
      build_ids,
      limit,
      cursor,
      sort_by,
      sort_order,
    }: Input) => {
      try {
        if ((from_timestamp && !to_timestamp) || (!from_timestamp && to_timestamp)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "from_timestamp and to_timestamp must be provided together (both or neither).",
              },
            ],
          };
        }

        const totalIds =
          (job_ids?.length ?? 0) +
          (task_ids?.length ?? 0) +
          (stage_ids?.length ?? 0) +
          (test_ids?.length ?? 0) +
          (build_ids?.length ?? 0);
        if (totalIds > 100) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Total ID count across job_ids/task_ids/stage_ids/test_ids/build_ids cannot exceed 100 (got ${totalIds}).`,
              },
            ],
          };
        }

        const response = await client.get(endpoints.insights.listTests, {
          params: {
            from_timestamp,
            to_timestamp,
            job_ids: job_ids?.join(","),
            task_ids: task_ids?.join(","),
            stage_ids: stage_ids?.join(","),
            test_ids: test_ids?.join(","),
            build_ids: build_ids?.join(","),
            limit,
            cursor,
            sort_by,
            sort_order,
          },
        });
        const records = unwrapDataArray(response);

        if (records.length === 0) {
          const notes = readStringArray((response as UnknownRecord)?.notes);
          return {
            content: [
              {
                type: "text",
                text:
                  notes.length > 0
                    ? notes.map((note) => `Note: ${note}`).join("\n")
                    : "No test execution records found for this scope/date range.",
              },
            ],
          };
        }

        const footer = formatFooter(response as UnknownRecord);
        const text = records.map(formatTest).join("\n\n") + (footer.length > 0 ? `\n\n${footer.join("\n")}` : "");

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
    const apiMessage = (error.response?.data as { error?: string } | undefined)?.error;

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test execution data: ${error instanceof Error ? error.message : "Unknown error"}`;
}
