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

// `page`/`per_page`/`sort` mirror the API's optional query parameters, so an
// AI agent can page through a project with many test cases instead of only
// ever seeing the first page.
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().optional(),
  sort: z.string().trim().optional(),
};

// Renders a single test case as plain text. Fields are read defensively (not
// via a strict schema) so a test case missing an optional field - e.g. no
// BDD scenario set - doesn't break formatting. Unlike the folder-scoped
// tool, each result here spans the whole project, so `Folder ID` is shown
// to say where each test case actually lives.
function formatTestCase(testCase: UnknownRecord): string {
  const tagNames = readTagNames(testCase.tags);

  const lines = [
    `Title: ${readString(testCase.title) ?? "N/A"}`,
    `Test Case ID: ${readString(testCase.test_case_id) ?? "N/A"}`,
    `Folder ID: ${readString(testCase.folder_id) ?? "N/A"}`,
    `Internal ID: ${readString(testCase.internal_id) ?? "N/A"}`,
    `External ID: ${readString(testCase.external_id) ?? "N/A"}`,
    `Description: ${readString(testCase.description) ?? "N/A"}`,
    `Priority: ${readString(testCase.priority) ?? "N/A"}`,
    `Type: ${readString(testCase.type) ?? "N/A"}`,
    `Status: ${readString(testCase.status) ?? "N/A"}`,
    `Automation Status: ${readString(testCase.automation_status) ?? "N/A"}`,
    `Estimated Time: ${readNumber(testCase.estimated_time) ?? "N/A"}`,
    `BDD Scenarios: ${readString(testCase.bdd_scenarios) ?? "N/A"}`,
    `Test Steps: ${readString(testCase.test_steps) ?? "N/A"}`,
    `Created At: ${readString(testCase.created_at) ?? "N/A"}`,
    `Updated At: ${readString(testCase.updated_at) ?? "N/A"}`,
    "Tags:",
  ];

  lines.push(...(tagNames.length > 0 ? tagNames.map((name) => `- ${name}`) : ["- (none)"]));

  return lines.join("\n");
}

export function registerGetTestCasesByProjectIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testCasesByProjectId",
    {
      title: "Get Test Manager Test Cases by Project ID",
      description:
        "Retrieves every test case across an entire LambdaTest Test Manager project, regardless of " +
        "which folder it's in: each test case's title, ID, folder ID, description, priority, type, " +
        "status, automation status, estimated time, BDD scenarios, test steps, and tags. Use this for " +
        "a project-wide view; use tm.get_foldersByProjectId + tm.get_testCasesByFolderId instead if you " +
        "only need the test cases inside one specific folder. Supports optional page, per_page, and " +
        "sort parameters for projects with many test cases.",
      inputSchema,
    },
    async ({ project_id, page, per_page, sort }) => {
      try {
        const response = await client.get(endpoints.testCases.listByProjectId(project_id), {
          params: { page, per_page, sort },
        });
        const testCases = unwrapDataArray(response);

        if (testCases.length === 0) {
          return {
            content: [{ type: "text", text: `No test cases found in project "${project_id}".` }],
          };
        }

        const footer = formatPaginationFooter(response, "test case");
        const text = testCases.map(formatTestCase).join("\n\n") + (footer ? `\n\n${footer}` : "");

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

    if (status === 422) {
      return `Could not retrieve test cases: invalid project ID "${projectId}".`;
    }

    if (status === 404) {
      return `Project not found: no project exists with ID "${projectId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test cases for project "${projectId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
