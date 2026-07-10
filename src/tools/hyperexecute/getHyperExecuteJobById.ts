import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapData, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  job_id: z.string().trim().min(1, "job_id is required"),
};

// Generic defensive JSON.parse - several fields on this endpoint (jobLabel,
// tasks[].context) are JSON-encoded STRINGS rather than real nested JSON.
// Returns undefined rather than throwing on a non-string input or malformed
// JSON, so callers can degrade gracefully instead of failing the whole tool.
function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// `jobLabel` is a JSON-encoded array string (e.g. `["KaneAI","Test Run","<id>-web"]`)
// - parsed into a readable "A › B › C" label. Falls back to showing the raw
// string as-is (still more useful than hiding it) if it can't be parsed as a
// string array, and only shows "N/A" if the field is genuinely empty/absent.
function formatJobLabel(value: unknown): string {
  const raw = readString(value);
  if (!raw) {
    return "N/A";
  }

  const parsed = tryParseJson(raw);
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
    return (parsed as string[]).join(" › ");
  }

  return raw;
}

// The three status-count objects on this endpoint (preStatusCount,
// postStatusCount, and scenarioStageSummary's own counts) each have ~14
// fields, almost always mostly zero - showing all of them every time (42
// lines total) would bury the output, so only non-zero fields are shown,
// unlike the fixed-set convention used for the smaller taskCount block below.
const STATUS_COUNT_FIELDS = [
  "created",
  "completed",
  "passed",
  "failed",
  "error",
  "lambdaError",
  "aborted",
  "cancelled",
  "skipped",
  "timeout",
  "stopped",
  "ignored",
  "muted",
  "inProgress",
  "logAvailable",
];

function formatStatusCounts(counts: unknown): string {
  const record = counts as UnknownRecord | undefined;
  if (!record) {
    return "N/A";
  }

  const nonZero = STATUS_COUNT_FIELDS.map((field) => {
    const value = readNumber(record[field]);
    return value !== undefined && value > 0 ? `${field}: ${value}` : undefined;
  }).filter((entry): entry is string => entry !== undefined);

  return nonZero.length > 0 ? nonZero.join(", ") : "(all zero)";
}

// taskCount is a small, genuinely fixed set (11 fields) - unlike the larger
// status-count objects above, always shown in full rather than non-zero-only.
function formatTaskCount(counts: unknown): string[] {
  const record = counts as UnknownRecord | undefined;

  return [
    `  Total: ${readNumber(record?.total) ?? "N/A"}`,
    `  Completed: ${readNumber(record?.completed) ?? "N/A"}`,
    `  Failed: ${readNumber(record?.failed) ?? "N/A"}`,
    `  Running: ${readNumber(record?.running) ?? "N/A"}`,
    `  Queued: ${readNumber(record?.queued) ?? "N/A"}`,
    `  Initiated: ${readNumber(record?.initiated) ?? "N/A"}`,
    `  Aborted: ${readNumber(record?.aborted) ?? "N/A"}`,
    `  Cancelled: ${readNumber(record?.cancelled) ?? "N/A"}`,
    `  Skipped: ${readNumber(record?.skipped) ?? "N/A"}`,
    `  Timeout: ${readNumber(record?.timeout) ?? "N/A"}`,
    `  Lambda Error: ${readNumber(record?.lambdaError) ?? "N/A"}`,
  ];
}

// `tasks[].context` (also a JSON-encoded string) is deliberately not parsed
// or shown here - its fields mostly duplicate what's already available
// directly on the task object below.
function formatTask(task: UnknownRecord, index: number): string {
  // `runsOn`/`parentTaskID` are the real response's casing; `runson`/
  // `parentTaskId` are what the OpenAPI spec documents - both checked since
  // the real API has been observed to diverge from its own spec here.
  const parentTaskId = readString(task.parentTaskID) ?? readString(task.parentTaskId);

  return [
    `${index + 1}. ${readString(task.id) ?? "N/A"} (${readString(task.os) ?? "N/A"})`,
    `   Status: ${readString(task.status)?.toUpperCase() ?? "N/A"}`,
    `   Type: ${readString(task.type) ?? "N/A"}`,
    `   Remark: ${readString(task.remark) ?? "N/A"}`,
    `   Group: ${readNumber(task.groupNumber) ?? "N/A"} | Iteration: ${readNumber(task.iteration) ?? "N/A"} | Debug: ${task.debug === true ? "Yes" : "No"} | SmartUI: ${task.smartUIEnabled === true ? "Yes" : "No"}`,
    `   Tunnel: ${readString(task.tunnelName) ?? "(none)"} | Parent Task: ${parentTaskId ?? "(none)"}`,
    `   Created At: ${readString(task.createdAt) ?? "N/A"}`,
    `   Updated At: ${readString(task.updateAt) ?? "N/A"}`,
    `   Start Time: ${readString(task.startTime) ?? "N/A"}`,
    `   End Time: ${readString(task.endTime) ?? "N/A"}`,
    `   Initiated At: ${readString(task.initiatedAt) ?? "N/A"} | Failed At: ${readString(task.failedAt) ?? "N/A"}`,
    `   Test IDs: ${readString(task.testIDs) ?? "(none)"} | Session IDs: ${readString(task.sessionIDs) ?? "(none)"}`,
  ].join("\n");
}

function formatJobSummary(jobSummary: unknown): string[] {
  const record = jobSummary as UnknownRecord | undefined;
  const scenarioSummary = record?.scenarioStageSummary as UnknownRecord | undefined;
  // `statusCountsExcludingRetries` is the real response's casing; the spec
  // documents snake_case `status_counts_excluding_retries` - both checked.
  const scenarioStatusCounts = scenarioSummary?.statusCountsExcludingRetries ?? scenarioSummary?.status_counts_excluding_retries;
  // `testStatusCount` is null in every response observed so far - shown
  // distinctly from "N/A" (couldn't be read) vs "(not available)" (field is
  // genuinely null).
  const testStatusCount = record?.testStatusCount;

  return [
    `  Pre-Run Status Counts: ${formatStatusCounts(record?.preStatusCount)}`,
    `  Post-Run Status Counts: ${formatStatusCounts(record?.postStatusCount)}`,
    "  Scenario Stage Summary:",
    `    Total (excluding retries): ${readNumber(scenarioSummary?.totalExcludingRetries) ?? "N/A"}`,
    `    Total Execution Time (incl. retries): ${readNumber(scenarioSummary?.totalExecutionTimeIncludingRetriesInSec) ?? "N/A"}s`,
    `    Retries: ${readNumber(scenarioSummary?.retries) ?? "N/A"}`,
    `    Total Retries Time: ${readNumber(scenarioSummary?.totalRetriesTimeInSec) ?? "N/A"}s`,
    `    Status Counts (excluding retries): ${formatStatusCounts(scenarioStatusCounts)}`,
    `  Test Status Count: ${testStatusCount === null ? "(not available)" : (readNumber(testStatusCount) ?? "N/A")}`,
  ];
}

// `executionTime`/`execution_time_sec` sit alongside `data` in the raw
// response (not inside it), so they must be read from the response before
// unwrapData discards everything but the `data` object.
function formatExecutionTime(response: UnknownRecord): string {
  const humanReadable = readString(response.executionTime);
  const seconds = readNumber(response.execution_time_sec);

  if (humanReadable && seconds !== undefined) {
    return `${humanReadable} (${seconds} sec)`;
  }
  return humanReadable ?? (seconds !== undefined ? `${seconds}s` : "N/A");
}

function formatJob(jobId: string, job: UnknownRecord, executionTime: string): string {
  // `runsOn` is the real response's casing; the spec documents `runson`.
  const runsOn = readString(job.runsOn) ?? readString(job.runson);
  const tasks = Array.isArray(job.tasks) ? (job.tasks as UnknownRecord[]) : [];
  const frameworks = Array.isArray(job.frameworks) ? (job.frameworks as string[]) : [];

  const lines = [
    `HyperExecute Job ${readString(job.id) ?? jobId}`,
    `Status: ${readString(job.status)?.toUpperCase() ?? "N/A"}`,
    `Job Number: ${readString(job.jobNumber) ?? readNumber(job.jobNumber) ?? "N/A"}`,
    `Label: ${formatJobLabel(job.jobLabel)}`,
    `Remark: ${readString(job.remark) ?? "N/A"}`,
    `Type: ${readString(job.type) ?? "N/A"} | Test Type: ${readString(job.testType) ?? "N/A"}`,
    `Frameworks: ${frameworks.length > 0 ? frameworks.join(", ") : "N/A"}`,
    `Org ID: ${readString(job.orgId) ?? "N/A"} | Triggered By: ${readString(job.user) ?? "N/A"}`,
    `Tunnel: ${readString(job.tunnelName) ?? "(none)"} | Runs On: ${runsOn ?? "(none)"}`,
    `Retry On Failure: ${job.retryOnFailure === true ? "Yes" : "No"} | Screen Recording (Scenarios): ${job.screenRecordingForScenarios === true ? "Yes" : "No"} | Dynamic Allocation: ${job.dynamic_allocation === true ? "Yes" : "No"}`,
    `Global Timeout: ${readNumber(job.globalTimeout) ?? "N/A"}s | Test Suite Timeout: ${readNumber(job.testSuiteTimeout) ?? "N/A"}s`,
    `Created At: ${readString(job.createdAt) ?? "N/A"}`,
    `Updated At: ${readString(job.updateAt) ?? "N/A"}`,
    `Start Time: ${readString(job.startTime) ?? "N/A"}`,
    `End Time: ${readString(job.endTime) ?? "N/A"}`,
    `Execution Time: ${executionTime}`,
    `Total Tests: ${readNumber(job.totalTests) ?? "N/A"}`,
    "",
    "Task Count:",
    ...formatTaskCount(job.taskCount),
    "",
  ];

  if (tasks.length === 0) {
    lines.push("(no tasks)");
  } else {
    lines.push("Tasks:", "", tasks.map(formatTask).join("\n\n"));
  }

  lines.push("", "Job Summary:", ...formatJobSummary(job.jobSummary));

  return lines.join("\n");
}

export function registerGetHyperExecuteJobByIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_hyperExecuteJobById",
    {
      title: "Get HyperExecute Job Status by Job ID",
      description:
        "Retrieves the current status and full detail of a HyperExecute Job by its job ID: " +
        "job-level info (status, job number, label, remark, job type, frameworks, org/user, " +
        "tunnel, retry-on-failure setting, global/test-suite timeout, created/updated/start/end " +
        "timestamps, total test count, execution time), a per-Task breakdown (each Task is one " +
        "independent VM/parallel worker running its share of tests sequentially - a job using " +
        "multiple parallels typically has multiple Tasks, each with its own status, OS, timing, " +
        "and retry iteration), a numeric task-count summary, and a job summary (pre-run/post-run " +
        "status breakdowns plus scenario-stage retry statistics).\n" +
        "Input: job_id (the HyperExecute Job ID, e.g. a UUID like " +
        '"11111111-1111-1111-1111-111111111111" - distinct from a Test Manager test_run_id or ' +
        "test_case_id; this tool does not discover a job_id from a Test Manager ID, it requires " +
        "one already known).\n" +
        "IMPORTANT: this is a snapshot at the moment of the call - for a still-queued/running job, " +
        "call again later for updated status. The API's jobLabel field is a JSON-encoded string " +
        "rather than a real array; parsed defensively into a readable label, falling back to the " +
        "raw value if unparseable. Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ job_id }) => {
      try {
        const response = await client.get(endpoints.hyperexecute.getJobById(job_id));
        const job = unwrapData(response);

        if (!readString(job?.id)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `No HyperExecute job data returned for job ID "${job_id}" (unexpected empty response).`,
              },
            ],
          };
        }

        const executionTime = formatExecutionTime(response as UnknownRecord);
        return { content: [{ type: "text", text: formatJob(job_id, job, executionTime) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, job_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, jobId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 404) {
      return `No HyperExecute job found with ID "${jobId}"${apiMessage ? `: ${apiMessage}` : "."}`;
    }

    return `HyperExecute API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve HyperExecute job "${jobId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
