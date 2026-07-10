import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// Only unlinking a Jira issue from a test case is supported - same scoping
// choice as tm.link_jiraIssue.
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  test_case_id: z.string().trim().min(1, "test_case_id is required"),
  jira_issue_id: z.string().trim().min(1, "jira_issue_id is required (e.g. 'PROJ-123')"),
};

export function registerRemoveJiraIssueTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.unlink_jiraIssue",
    {
      title: "Unlink Jira Issue from Test Manager Test Case",
      description:
        "Removes the link between a Jira issue (e.g. 'PROJ-123') and a LambdaTest Test Manager test case, " +
        "reversing tm.link_jiraIssue. Requires the project ID, test case ID, and the Jira issue key. " +
        "Unlike tm.link_jiraIssue, the issue key is passed as-is - no org_id prefix is needed here. " +
        "Fails if the issue isn't actually linked to that test case. Do not call this speculatively - " +
        "unlinking is a real, persistent action.",
      inputSchema,
    },
    async ({ project_id, test_case_id, jira_issue_id }) => {
      try {
        const response = await client.post(endpoints.jira.remove, {
          project_id,
          entity_id: test_case_id,
          entity_type: "test_case",
          jira_id: jira_issue_id,
        });
        const result = unwrapData(response);

        if (readString(result?.type) !== "Success") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not unlink Jira issue "${jira_issue_id}" from test case "${test_case_id}": ${
                  readString(result?.message) ?? "unexpected response from the API."
                }`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Jira issue "${jira_issue_id}" unlinked successfully from test case "${test_case_id}".`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: describeError(error, project_id, jira_issue_id, test_case_id) }],
        };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, projectId: string, jiraIssueId: string, testCaseId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 400) {
      return (
        `Could not unlink Jira issue "${jiraIssueId}" from test case "${testCaseId}": ${apiMessage ?? "invalid input."} ` +
        "This usually means the issue isn't actually linked to this test case, or one of the IDs is wrong."
      );
    }

    if (status === 422) {
      return `Could not unlink Jira issue: ${apiMessage ?? `invalid project ID "${projectId}".`}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to unlink Jira issue "${jiraIssueId}" from test case "${testCaseId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
