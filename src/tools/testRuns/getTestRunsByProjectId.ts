import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import {
  formatPaginationFooter,
  readNumber,
  readString,
  readTagNames,
  unwrapDataArray,
  type UnknownRecord,
} from "../../utils/response.js";

const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().optional(),
  status: z.string().trim().optional(),
  build_state: z.string().trim().optional(),
  folder_id: z.string().trim().optional(),
};

// On this endpoint, `run_result` (total_test/passed/failed/skipped/not_started)
// is unreliable - it reports all-zero counts (other than total_test) even
// for runs with real results. `run_result_v2` is a dynamic map keyed by
// whatever status labels actually occurred (not a fixed set), and IS
// accurate; use it instead.
function formatRunResult(runResultV2: unknown): string[] {
  const record = runResultV2 as UnknownRecord | undefined;
  if (!record) {
    return ["  (no run result data)"];
  }

  const total = readNumber(record.total_test);
  const lines = [`  Total: ${total ?? "N/A"}`];

  for (const [key, value] of Object.entries(record)) {
    if (key === "total_test") continue;
    lines.push(`  ${key}: ${readNumber(value) ?? value}`);
  }

  return lines;
}

function formatTestRun(run: UnknownRecord): string {
  const tags = readTagNames(run.tags);
  // Confirmed only reliably populated on this endpoint - GET
  // /api/v1/test-run/{id} and GET /api/v1/test-run/instances/{id} both
  // return an empty folder_id for the same run.
  const folderId = readString(run.folder_id);
  // `is_editable`/`kane_schedule_name` are only reliably populated on this
  // endpoint, not GET /api/v1/test-run/{id} (which does still carry
  // is_auteur_generated).
  const isKaneAiGenerated = run.is_auteur_generated === true;
  const kaneScheduleName = readString(run.kane_schedule_name);

  return [
    `${readString(run.title) ?? "N/A"} (ID: ${readString(run.id) ?? "N/A"})`,
    `Folder ID: ${folderId ?? "(root - no folder)"}`,
    `Status: ${readString(run.status) ?? "N/A"}`,
    `Type: ${readString(run.type) ?? "N/A"}`,
    `KaneAI-Generated: ${isKaneAiGenerated ? "Yes" : "No"}${kaneScheduleName ? ` (schedule: ${kaneScheduleName})` : ""}`,
    `Editable: ${run.is_editable === false ? "No" : "Yes"}`,
    `Build State: ${readString(run.build_state) ?? "N/A"}`,
    `Build Disabled: ${run.is_build_disabled === true ? "Yes" : "No"}`,
    `Objective: ${readString(run.objective) ?? "N/A"}`,
    `Tags: ${tags.length > 0 ? tags.join(", ") : "(none)"}`,
    `Created At: ${readString(run.created_at) ?? "N/A"} (by user ${readNumber(run.created_by) ?? "N/A"})`,
    `Updated At: ${readString(run.updated_at) ?? "N/A"} (by user ${readNumber(run.updated_by) ?? "N/A"})`,
    // On THIS endpoint, total_test_cases/total_environments/total_run_instances
    // ARE genuinely distinct (distinct test case count, distinct environment
    // config count, actual instance count) - unlike tm.get_testRunById, where
    // the equivalently-named raw fields are all just duplicates of the
    // instance count instead.
    `Test Cases (distinct): ${readNumber(run.total_test_cases) ?? "N/A"}`,
    `Environments (distinct): ${readNumber(run.total_environments) ?? "N/A"}`,
    `Total Test Case Instances (test case x environment pairings, NOT unique test count): ${readNumber(run.total_run_instances) ?? "N/A"}`,
    `Complete: ${readNumber(run.complete_percent) ?? "N/A"}%`,
    "Run Result:",
    ...formatRunResult(run.run_result_v2),
  ].join("\n");
}

export function registerGetTestRunsByProjectIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testRunsByProjectId",
    {
      title: "Get Test Manager Test Runs by Project ID",
      description:
        "Retrieves every test run in a LambdaTest Test Manager project: title, folder ID, status, " +
        "type, build state, objective, tags, distinct test case/environment counts, total test case " +
        "instances, percent complete, and a pass/failed/skipped/etc. breakdown.\n" +
        "KANEAI RUNS: a run's top-level `type` field is ALWAYS 'Manual' regardless of whether it's a " +
        "real manual run or a KaneAI-generated one - it does not distinguish them, despite the name. " +
        "The actual signal is 'KaneAI-Generated' (the API's is_auteur_generated field) - true for a " +
        "run KaneAI itself created. Manual and KaneAI test runs are not interchangeable (a manual test " +
        "case cannot correctly run inside a KaneAI run and vice versa) regardless of the separate " +
        "'Editable'/schedule fields - use 'KaneAI-Generated' before calling tm.add_testCasesToTestRun, " +
        "which refuses to modify any KaneAI-generated run. 'Editable: No' and a schedule name instead " +
        "indicate the run's composition is currently owned/regenerated by an active KaneAI schedule - " +
        "a related but separate concern from manual/KaneAI compatibility (a one-off, unscheduled " +
        "KaneAI run can be 'Editable: Yes' and still be a KaneAI run).\n" +
        "FOLDERS: test runs can be organized into their own folders/subfolders, entirely separate " +
        "from the folder tree used for test cases (tm.get_foldersByProjectId) - a test run's folder " +
        "and the folders its individual test cases live in are unrelated concepts and do not share " +
        "IDs. This is currently the only tool that reliably reports a test run's OWN folder_id - " +
        "tm.get_testRunById and tm.get_testCaseInstancesByTestRunId both return an empty folder_id " +
        "for the same run. There is no known endpoint to browse/resolve the test-run folder tree " +
        "itself (name, parent, path) - only this raw folder_id value is available so far.\n" +
        "TERMINOLOGY: a 'test case instance' is ONE (test case x environment) pairing, not one test " +
        "case - e.g. 1 test case assigned 2 environments contributes 2 to 'Total Test Case Instances' but only 1 to " +
        "'Test Cases'. 'Test Cases' and 'Environments (distinct)' below ARE correctly distinct counts " +
        "on this endpoint (unlike tm.get_testRunById, where the API's equivalently-named raw fields are " +
        "all just duplicates of the instance count - that tool works around it by computing its own " +
        "distinct counts, so both tools' numbers should agree for the same run).\n" +
        "Supports pagination (page, per_page) and filtering by status (e.g. 'Not Started', 'In " +
        "Progress', 'Passed', 'Failed', 'Skipped'), build_state ('active' or 'archived'), and/or " +
        "folder_id (the test run's OWN folder - see the Folder ID note above; this is NOT the " +
        "folder_id of any test case inside the run). Use tm.get_testRunById or " +
        "tm.get_testCaseInstancesByTestRunId for full detail on a specific run. Read-only; does not " +
        "modify anything.",
      inputSchema,
    },
    async ({ project_id, page, per_page, status, build_state, folder_id }) => {
      try {
        const response = await client.get(endpoints.testRuns.listByProjectId(project_id), {
          params: {
            page,
            per_page,
            "filter[status]": status,
            "filter[build_state]": build_state,
            "filter[folder_id]": folder_id,
          },
        });
        const runs = unwrapDataArray(response);

        if (runs.length === 0) {
          return {
            content: [{ type: "text", text: `No test runs found in project "${project_id}".` }],
          };
        }

        const footer = formatPaginationFooter(response, "test run");
        const text = runs.map(formatTestRun).join("\n\n") + (footer ? `\n\n${footer}` : "");

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, project_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, projectId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422 || status === 404) {
      // The API's own message says "Test Run not found" here even when the
      // problem is the project ID, not a test run - deliberately not
      // surfaced to avoid a confusing combination.
      return `Project not found: no project exists with ID "${projectId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test runs for project "${projectId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
