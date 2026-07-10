import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// This tool only creates the test run shell (title/objective/tags/project).
// Test cases and their environment assignments are added afterward via a
// separate PUT request, not this one. `tags` is a genuinely variable-length
// list, same convention as tm.create_project. `test_run_instances` is
// deliberately NOT exposed as an input here - this POST endpoint ignores it
// entirely regardless of shape; every run it creates comes back with 0 test
// cases no matter what's sent.
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  title: z.string().trim().min(1, "title is required"),
  objective: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1, "tag must not be empty")).optional().default([]),
  folder_id: z.string().trim().min(1, "folder_id must not be empty if provided").optional(),
  is_auteur_generated: z.boolean().optional().default(false),
};

type CreateTestRunInput = {
  project_id: string;
  title: string;
  objective?: string;
  tags: string[];
  folder_id?: string;
  is_auteur_generated: boolean;
};

// The API's create response only returns { message, type, id } - it doesn't
// echo back the run's details - so the confirmation is built from the input
// rather than re-derived from the response, same convention as
// tm.create_project.
function formatCreatedTestRun(testRunId: string, input: CreateTestRunInput): string {
  const lines = [
    "Test Run Created Successfully",
    `Test Run ID: ${testRunId}`,
    `Title: ${input.title}`,
    `Objective: ${input.objective ?? "N/A"}`,
    `Project ID: ${input.project_id}`,
    `Folder ID: ${input.folder_id ?? "(root - no folder)"}`,
    `KaneAI-Generated: ${input.is_auteur_generated ? "Yes" : "No"}`,
    "Tags:",
  ];

  lines.push(...(input.tags.length > 0 ? input.tags.map((tag) => `- ${tag}`) : ["- (none)"]));
  lines.push(
    "",
    "This run has no test cases yet - add them afterward via tm.add_testCasesToTestRun." +
      (input.is_auteur_generated
        ? " Since this is a KaneAI-type run, only KaneAI test cases (own is_auteur_generated: true) " +
          "can be added to it, not manual ones."
        : ""),
  );

  return lines.join("\n");
}

export function registerCreateTestRunTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.create_testRun",
    {
      title: "Create Test Manager Test Run",
      description:
        "Creates just the SHELL of a new LambdaTest Test Manager test run in a project: a title " +
        "(required), an optional objective, any number of tags (zero or more), and an optional " +
        "folder_id to place it inside a test-run folder (from tm.get_testRunFoldersByProjectId - " +
        "this is the test-run folder tree, separate from test case folders) instead of the project " +
        "root. This always creates the run with ZERO test cases - test cases and their environment " +
        "assignments are added to the run afterward via a separate PUT request, not this tool. " +
        "DANGER: an invalid/nonexistent folder_id causes an unhandled server error (HTTP 500) rather " +
        "than a clean validation error - no run is created in that case (safe to retry), but only " +
        "pass a folder_id read from tm.get_testRunFoldersByProjectId. Use tm.get_testRunById " +
        "afterward to confirm the run was created. Do not call this speculatively - creating a test " +
        "run is a real, persistent action.\n" +
        "KANEAI RUNS: set is_auteur_generated: true to create a one-off KaneAI-type run instead of a " +
        "plain manual run. This only creates the KaneAI-type run shell - it does NOT create or link a " +
        "KaneAI schedule (schedules are managed by KaneAI itself, not this API). Manual and KaneAI test " +
        "cases are not interchangeable: once created, only add test cases whose own is_auteur_generated " +
        "matches this run's, via tm.add_testCasesToTestRun.",
      inputSchema,
    },
    async (input) => {
      try {
        const response = await client.post(endpoints.testRuns.create, {
          title: input.title,
          objective: input.objective ?? "",
          test_run_instances: [],
          tags: input.tags,
          project_id: input.project_id,
          is_auteur_generated: input.is_auteur_generated,
          folder_id: input.folder_id,
        });
        const result = unwrapData(response);

        const testRunId = readString(result?.id);
        if (!testRunId) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test run creation did not return an ID for "${input.title}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatCreatedTestRun(testRunId, input) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: describeError(error, input.title, input.project_id, input.folder_id) }],
        };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, title: string, projectId: string, folderId: string | undefined): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    // Unlike every other error in this API, an invalid folder_id here comes
    // back as a raw `text/plain` SQL error string (not the usual JSON
    // { type, title, message } envelope) - read response.data directly as a
    // string rather than assuming it's an object with a `.message` field.
    const rawBody = error.response?.data;
    const rawBodyText = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? "");

    if (status === 500 && folderId && rawBodyText.toLowerCase().includes("foreign key")) {
      // No run is created in this case (the DB transaction rolls back), so
      // this is safe to retry with a valid folder_id, but the raw SQL
      // message (leaking internal table/column names) is not worth showing
      // verbatim.
      return `Could not create test run "${title}": folder_id "${folderId}" does not exist as a test-run folder in this project. No run was created.`;
    }

    if (status === 422) {
      // Zod already guarantees `title` is non-empty before the request is
      // sent, so any 422 reaching here can only be the invalid-project_id
      // case - the API's own message text says "Invalid test run ID" for
      // that, which is wrong/confusing, so it's deliberately not surfaced
      // verbatim.
      return `Could not create test run "${title}": invalid project_id "${projectId}".`;
    }

    // The API's `message` field is usually a string, but for field-level
    // validation errors it comes back as an object instead (e.g.
    // `{ title: "title is a required field" }`) - stringify defensively
    // rather than assuming it's always text.
    const rawMessage = (error.response?.data as { message?: unknown } | undefined)?.message;
    const apiMessage = typeof rawMessage === "string" ? rawMessage : rawMessage ? JSON.stringify(rawMessage) : undefined;

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to create test run "${title}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
