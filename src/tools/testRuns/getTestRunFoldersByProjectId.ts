import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapDataArray, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
};

// Same recursive-children shape as the test-case folder tree
// (tm.get_foldersByProjectId), but this is a completely separate folder
// tree scoped to test runs - a folder ID here does not appear anywhere in
// the test-case folder tree, and vice versa.
function formatFolder(folder: UnknownRecord, depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines = [
    `${indent}Folder Name: ${readString(folder.name) ?? "N/A"}`,
    `${indent}Folder ID: ${readString(folder.id) ?? "N/A"}`,
    `${indent}Description: ${readString(folder.description) ?? "N/A"}`,
    `${indent}Parent ID: ${readString(folder.parent_id) ?? "(root)"}`,
    `${indent}Created At: ${readString(folder.created_at) ?? "N/A"}`,
    `${indent}Updated At: ${readString(folder.updated_at) ?? "N/A"}`,
    `${indent}Test Runs (direct): ${readNumber(folder.test_run_count) ?? "N/A"}`,
    `${indent}Test Runs (including subfolders): ${readNumber(folder.total_test_run_count) ?? "N/A"}`,
  ];

  const children = Array.isArray(folder.children) ? (folder.children as UnknownRecord[]) : [];
  for (const child of children) {
    lines.push("", formatFolder(child, depth + 1));
  }

  return lines.join("\n");
}

export function registerGetTestRunFoldersByProjectIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testRunFoldersByProjectId",
    {
      title: "Get Test Manager Test Run Folders by Project ID",
      description:
        "Retrieves the folder/subfolder hierarchy used to organize TEST RUNS in a LambdaTest Test " +
        "Manager project: each folder's name, ID, description, parent folder, timestamps, and test " +
        "run counts (direct and including subfolders). This is a SEPARATE folder tree from test case " +
        "folders (tm.get_foldersByProjectId) - the two do not share folder IDs. This tool only " +
        "returns the folder structure and counts, not the runs themselves - use " +
        "tm.get_testRunsByProjectId with its folder_id filter, passing a folder ID from here, to list " +
        "the actual test runs inside a given folder. Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ project_id }) => {
      try {
        const response = await client.get(endpoints.testRunFolders.listByProjectId(project_id));
        const folders = unwrapDataArray(response);

        if (folders.length === 0) {
          return {
            content: [{ type: "text", text: `No test run folders found for project "${project_id}".` }],
          };
        }

        return {
          content: [{ type: "text", text: folders.map((folder) => formatFolder(folder)).join("\n\n") }],
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

  return `Failed to retrieve test run folders for project "${projectId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
