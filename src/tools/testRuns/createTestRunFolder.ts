import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// `parent_id` is optional: omit it to create a root-level test-run folder in
// the project (matches how tm.get_testRunFoldersByProjectId shows root
// folders with no parent, displayed as "(root)").
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  name: z.string().trim().min(1, "name is required"),
  description: z.string().trim().optional(),
  parent_id: z.string().trim().min(1, "parent_id must not be empty if provided").optional(),
};

type CreateTestRunFolderInput = {
  project_id: string;
  name: string;
  description?: string;
  parent_id?: string;
};

// The API's create response only returns { message, type, id } - it doesn't
// echo back the folder details - so the confirmation is built from the
// input rather than re-derived from the response, same approach as
// tm.create_folder.
function formatCreatedFolder(folderId: string, input: CreateTestRunFolderInput): string {
  return [
    "Test Run Folder Created Successfully",
    `Folder ID: ${folderId}`,
    `Folder Name: ${input.name}`,
    `Description: ${input.description ?? "N/A"}`,
    `Project ID: ${input.project_id}`,
    `Parent ID: ${input.parent_id ?? "(root)"}`,
  ].join("\n");
}

export function registerCreateTestRunFolderTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.create_testRunFolder",
    {
      title: "Create Test Manager Test Run Folder",
      description:
        "Creates a new folder inside a LambdaTest Test Manager project, to organize TEST RUNS. This " +
        "is a separate folder tree from test case folders (tm.create_folder) - the two do not share " +
        "folder IDs. Requires the project's ID; optionally nest it under an existing test-run folder " +
        "by passing that folder's ID (from tm.get_testRunFoldersByProjectId) as parent_id, otherwise " +
        "it's created at the project's root. Do not use this to update or move an existing folder, " +
        "and do not call it speculatively - creating a folder is a real, persistent action.",
      inputSchema,
    },
    async (input) => {
      try {
        // The API accepts a batch of folders in one call; we always send a
        // single-item array since this tool creates exactly one folder.
        const response = await client.post(endpoints.testRunFolders.create, {
          folders: [
            {
              name: input.name,
              description: input.description,
              entity_id: input.project_id,
              entity_type: "test_run",
              parent_id: input.parent_id,
            },
          ],
        });
        const result = unwrapData(response);

        const folderId = readString(result?.id);
        if (!folderId) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test run folder creation did not return an ID for "${input.name}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatCreatedFolder(folderId, input) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, input) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, input: CreateTestRunFolderInput): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 404) {
      return `Project not found: no project exists with ID "${input.project_id}".`;
    }

    if (status === 422) {
      return `Could not create test run folder "${input.name}": ${apiMessage ?? "the request was invalid."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to create test run folder "${input.name}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
