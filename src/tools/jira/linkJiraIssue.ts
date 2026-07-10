import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import { config } from "../../config.js";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// Only linking a Jira issue to a test case is supported - the API also
// accepts other entity_type values per its naming, but test_case is the only
// one this tool exposes, so it's hardcoded rather than taken as input.
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
  test_case_id: z.string().trim().min(1, "test_case_id is required"),
  jira_issue_id: z.string().trim().min(1, "jira_issue_id is required (e.g. 'PROJ-123')"),
};

export function registerLinkJiraIssueTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.link_jiraIssue",
    {
      title: "Link Jira Issue to Test Manager Test Case",
      description:
        "Links a Jira issue (e.g. 'PROJ-123') to a LambdaTest Test Manager test case, so the issue shows " +
        "up in the test case's Jira links and the test case's runs appear in " +
        "tm.get_testExecutionHistoryByJiraId for that issue. Requires the project ID and test case ID. " +
        "The Jira issue must belong to the LambdaTest account/org configured via LT_ORG_ID in this server's config. " +
        "Do not call this speculatively - linking is a real, persistent action.",
      inputSchema,
    },
    async ({ project_id, test_case_id, jira_issue_id }) => {
      if (!config.testManager.orgId) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Cannot link Jira issue: LT_ORG_ID is not set in this server's environment configuration.",
            },
          ],
        };
      }

      try {
        const response = await client.post(endpoints.jira.link, {
          project_id,
          entity_id: test_case_id,
          entity_type: "test_case",
          jira_id: `${config.testManager.orgId}:${jira_issue_id}`,
        });
        const result = unwrapData(response);

        if (readString(result?.type) !== "Success") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not link Jira issue "${jira_issue_id}" to test case "${test_case_id}": ${
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
              text: `Jira issue "${jira_issue_id}" linked successfully to test case "${test_case_id}".`,
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, jira_issue_id, test_case_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, jiraIssueId: string, testCaseId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 404) {
      return (
        `Could not link Jira issue "${jiraIssueId}": ${apiMessage ?? "resource not found."} This can mean the ` +
        "issue doesn't exist, isn't visible to the connected Jira org, or the Jira connection needs to be " +
        "resynced in the LambdaTest UI."
      );
    }

    if (status === 422) {
      return `Could not link Jira issue "${jiraIssueId}" to test case "${testCaseId}": ${apiMessage ?? "the request was invalid."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to link Jira issue "${jiraIssueId}" to test case "${testCaseId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
