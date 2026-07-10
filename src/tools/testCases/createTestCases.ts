import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readStringArray, unwrapData } from "../../utils/response.js";

// One entry per test case to create. `tags` is a genuinely variable-length
// list - zero, one, or many - same convention as tm.create_project.
const testCaseSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  description: z.string().trim().optional(),
  preconditions: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1, "tag must not be empty")).optional().default([]),
});

// The API creates a batch of test cases in one call, all landing in the
// same project (+ folder, if given). At least one test case is required -
// an empty batch would be a no-op call that's more likely a caller mistake
// than an intentional one.
//
// `folder_id` is optional: confirmed against the live API that omitting it
// doesn't fail or leave the test case truly folder-less - the API auto-
// creates (or reuses) a default "Untitled" folder at the project's root and
// places it there instead.
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  folder_id: z.string().trim().min(1, "folder_id must not be empty if provided").optional(),
  test_cases: z.array(testCaseSchema).min(1, "at least one test case is required"),
};

type TestCaseInput = z.infer<typeof testCaseSchema>;

// The API returns the created IDs as a single array (`id: [...]`), in the
// same order as the `test_cases` array we sent - there's no per-item
// echoing of title/description, so IDs are matched back to input by index.
function formatCreatedTestCases(ids: string[], testCases: TestCaseInput[]): string {
  const lines = ["Test Cases Created Successfully"];

  const count = Math.max(ids.length, testCases.length);
  for (let i = 0; i < count; i++) {
    const testCase = testCases[i];
    const id = ids[i];

    lines.push("", `Test Case ID: ${id ?? "N/A"}`);
    if (testCase) {
      lines.push(
        `Title: ${testCase.title}`,
        `Description: ${testCase.description ?? "N/A"}`,
        `Preconditions: ${testCase.preconditions ?? "N/A"}`,
        "Tags:",
      );
      lines.push(...(testCase.tags.length > 0 ? testCase.tags.map((tag) => `- ${tag}`) : ["- (none)"]));
    }
  }

  return lines.join("\n");
}

export function registerCreateTestCasesTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.create_testCases",
    {
      title: "Create Test Manager Test Cases",
      description:
        "Creates one or more test cases in a LambdaTest Test Manager project, in a single batch call. " +
        "Each test case has a title (required), an optional description, optional preconditions, and " +
        "any number of tags (zero or more). Requires the project ID; folder_id is optional - pass it " +
        "(use tm.get_foldersByProjectId to find a folder's ID) to place the test cases in a specific " +
        "folder, or omit it to let the API place them in the project's default 'Untitled' root folder. " +
        "Use this when the user wants to add new test cases to a project. Do not use this to update an " +
        "existing test case, and do not call it speculatively - creating test cases is a real, " +
        "persistent action.",
      inputSchema,
    },
    async ({ project_id, folder_id, test_cases }) => {
      try {
        const response = await client.post(endpoints.testCases.create, {
          project_id,
          folder_id,
          test_cases,
        });
        const result = unwrapData(response);

        const ids = readStringArray(result?.id);
        if (ids.length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test case creation did not return any IDs for project "${project_id}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatCreatedTestCases(ids, test_cases) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, project_id, folder_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, projectId: string, folderId: string | undefined): string {
  const folderContext = folderId ? ` or folder ID "${folderId}"` : "";

  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422) {
      return `Could not create test cases: ${apiMessage ?? `invalid project ID "${projectId}"${folderContext}, or invalid test case data.`}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to create test cases for project "${projectId}"${folderContext}: ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
