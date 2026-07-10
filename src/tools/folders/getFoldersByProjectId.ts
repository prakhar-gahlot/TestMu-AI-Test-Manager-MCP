import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapDataArray, type UnknownRecord } from "../../utils/response.js";

// Input schema for the tool. `.trim()` normalizes whitespace before `.min(1)`
// rejects it, so " " (whitespace-only) is treated the same as "" (empty).
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
};

// Renders a single folder as plain text. Fields are read defensively (not
// via a strict schema) so a folder missing an optional field - e.g. a
// root-level folder with no `parent_id` - doesn't break formatting.
//
// The API nests subfolders under a `children` array on their parent rather
// than listing every folder flat, so this recurses into `children` and
// indents each level - otherwise nested folders would silently disappear
// from the output even though they're present in the response.
function formatFolder(folder: UnknownRecord, depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines = [
    `${indent}Folder Name: ${readString(folder.name) ?? "N/A"}`,
    `${indent}Folder ID: ${readString(folder.id) ?? "N/A"}`,
    `${indent}Description: ${readString(folder.description) ?? "N/A"}`,
    `${indent}Parent ID: ${readString(folder.parent_id) ?? "(root)"}`,
    `${indent}Created At: ${readString(folder.created_at) ?? "N/A"}`,
    `${indent}Updated At: ${readString(folder.updated_at) ?? "N/A"}`,
    // `test_cases_count` is direct test cases in this folder only;
    // `total_test_cases_count` includes everything nested under it too.
    // tm.get_testCasesByFolderId only ever returns the direct count - if the
    // two numbers differ here, that's the API's signal that subfolders hold
    // additional test cases that tool call won't surface.
    `${indent}Test Cases (direct): ${readNumber(folder.test_cases_count) ?? "N/A"}`,
    `${indent}Test Cases (including subfolders): ${readNumber(folder.total_test_cases_count) ?? "N/A"}`,
  ];

  const children = Array.isArray(folder.children) ? (folder.children as UnknownRecord[]) : [];
  for (const child of children) {
    lines.push("", formatFolder(child, depth + 1));
  }

  return lines.join("\n");
}

export function registerGetFoldersByProjectIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_foldersByProjectId",
    {
      title: "Get Test Manager Folders by Project ID",
      description:
        "Retrieves every folder in a LambdaTest Test Manager project, given the project's ID: " +
        "each folder's name, ID, description, parent folder, created/updated timestamps, and " +
        "test case counts (both direct and including subfolders). Use this to see how a project's " +
        "test cases are organized, to find a folder's ID before adding test cases to it, or to spot " +
        "folders whose direct and total test case counts differ (meaning subfolders hold more test " +
        "cases than tm.get_testCasesByFolderId alone would show for that folder). Do not use this to " +
        "fetch a single folder's details.",
      inputSchema,
    },
    async ({ project_id }) => {
      try {
        const response = await client.get(endpoints.folders.listByProjectId(project_id));
        const folders = unwrapDataArray(response);

        if (folders.length === 0) {
          return {
            content: [{ type: "text", text: `No folders found for project "${project_id}".` }],
          };
        }

        return {
          content: [{ type: "text", text: folders.map(formatFolder).join("\n\n") }],
        };
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

    if (status === 404) {
      return `Project not found: no project exists with ID "${projectId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve folders for project "${projectId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
