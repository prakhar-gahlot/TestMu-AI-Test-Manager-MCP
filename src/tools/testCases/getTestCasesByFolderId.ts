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
// AI agent can page through a folder with many test cases instead of only
// ever seeing the first page.
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  folder_id: z.string().trim().min(1, "folder_id is required"),
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().optional(),
  sort: z.string().trim().optional(),
};

// Renders a single test case as plain text. Fields are read defensively (not
// via a strict schema) so a test case missing an optional field - e.g. no
// preconditions set - doesn't break formatting.
function formatTestCase(testCase: UnknownRecord): string {
  const tagNames = readTagNames(testCase.tags);

  const lines = [
    `Title: ${readString(testCase.title) ?? "N/A"}`,
    `Test Case ID: ${readString(testCase.test_case_id) ?? "N/A"}`,
    `Internal ID: ${readString(testCase.internal_id) ?? "N/A"}`,
    `Description: ${readString(testCase.description) ?? "N/A"}`,
    `Priority: ${readString(testCase.priority) ?? "N/A"}`,
    `Type: ${readString(testCase.type) ?? "N/A"}`,
    `Status: ${readString(testCase.status) ?? "N/A"}`,
    `Automation Status: ${readString(testCase.automation_status) ?? "N/A"}`,
    `Preconditions: ${readString(testCase.preconditions) ?? "N/A"}`,
    `Estimated Time: ${readNumber(testCase.estimated_time) ?? "N/A"}`,
    `Created At: ${readString(testCase.created_at) ?? "N/A"}`,
    `Updated At: ${readString(testCase.updated_at) ?? "N/A"}`,
    "Tags:",
  ];

  lines.push(...(tagNames.length > 0 ? tagNames.map((name) => `- ${name}`) : ["- (none)"]));

  return lines.join("\n");
}

export function registerGetTestCasesByFolderIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testCasesByFolderId",
    {
      title: "Get Test Manager Test Cases by Folder ID",
      description:
        "Retrieves the test cases assigned DIRECTLY to a specific folder of a LambdaTest Test Manager " +
        "project - it does not include test cases in that folder's subfolders. Each result has the " +
        "test case's title, ID, description, priority, type, status, automation status, " +
        "preconditions, estimated time, and tags. Requires both the project ID and the folder ID " +
        "(use tm.get_foldersByProjectId first to find a folder's ID - it also shows each folder's " +
        "direct vs. total test case count, so you can tell if subfolders hold more). Supports optional " +
        "page, per_page, and sort parameters for folders with many test cases. Do not use this to fetch " +
        "a single test case by its own ID, and do not expect it to include subfolder contents.",
      inputSchema,
    },
    async ({ project_id, folder_id, page, per_page, sort }) => {
      try {
        const response = await client.get(endpoints.testCases.listByFolderId(project_id, folder_id), {
          params: { page, per_page, sort },
        });
        const testCases = unwrapDataArray(response);

        if (testCases.length === 0) {
          return {
            content: [{ type: "text", text: `No test cases found in folder "${folder_id}".` }],
          };
        }

        const footer = formatPaginationFooter(response, "test case");
        const text = testCases.map(formatTestCase).join("\n\n") + (footer ? `\n\n${footer}` : "");

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, project_id, folder_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, projectId: string, folderId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422) {
      return `Could not retrieve test cases: invalid project ID "${projectId}" or folder ID "${folderId}".`;
    }

    if (status === 404) {
      return `Not found: no project "${projectId}" or folder "${folderId}" exists.`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test cases for folder "${folderId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
