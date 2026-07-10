import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readAttachmentFileKeys, readNumber, readString, readTagNames, unwrapData, type UnknownRecord } from "../../utils/response.js";

// Input schema for the tool. `.trim()` normalizes whitespace before `.min(1)`
// rejects it, so " " (whitespace-only) is treated the same as "" (empty).
const inputSchema = {
  test_case_id: z.string().trim().min(1, "test_case_id is required"),
};

// `path` is the folder breadcrumb from the project's root down to the test
// case's own folder, e.g. [{name: "Root"}, {name: "Sub"}] -> "Root > Sub".
function formatPath(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "N/A";
  }

  const names = value
    .map((entry) => (entry && typeof entry === "object" ? readString((entry as UnknownRecord).name) : undefined))
    .filter((name): name is string => name !== undefined);

  return names.length > 0 ? names.join(" > ") : "N/A";
}

// Each attachment's `file_key` is what tm.update_testCase expects back (as
// either the top-level `attachments` field or a new_steps entry's own
// `attachments`) - shown alongside the human-readable file_name so an agent
// can both see what's attached and reuse the ID to carry it forward.
function formatAttachmentsInline(value: unknown): string | undefined {
  const fileKeys = readAttachmentFileKeys(value);
  if (fileKeys.length === 0) {
    return undefined;
  }

  const records = value as UnknownRecord[];
  return fileKeys
    .map((fileKey, index) => `${readString(records[index]?.file_name) ?? "N/A"} (file_key: ${fileKey})`)
    .join(", ");
}

// Each step has a description and expected outcome. Read defensively so a
// step missing `outcome` (or any other field) still renders.
function formatTestSteps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["(none)"];
  }

  return value.flatMap((step, index) => {
    const record = step as UnknownRecord;
    const description = readString(record?.description) ?? "N/A";
    const outcome = readString(record?.outcome) ?? "N/A";
    const lines = [`${index + 1}. ${description} -> ${outcome}`];

    const attachments = formatAttachmentsInline(record?.attachments);
    if (attachments) {
      lines.push(`   Attachments: ${attachments}`);
    }

    return lines;
  });
}

// Custom fields configured on the project, each with a name and the value
// set on this specific test case.
function formatDynamicFields(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["(none)"];
  }

  return value.map((field) => {
    const record = field as UnknownRecord;
    const name = readString(record?.field_name) ?? "N/A";
    const fieldValue = readString(record?.value) ?? "(empty)";
    return `- ${name}: ${fieldValue}`;
  });
}

function formatJiraDetails(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["(none)"];
  }

  return value.map((entry) => {
    const record = entry as UnknownRecord;
    const jiraId = readString(record?.jira_id) ?? "N/A";
    const jiraLink = readString(record?.jira_link) ?? "N/A";
    return `- ${jiraId}: ${jiraLink}`;
  });
}

// BDD scenario shape isn't fully specified by the API docs (`items: type:
// undefined`), so each entry is stringified defensively rather than reading
// specific fields that might not exist.
function formatBddScenarios(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["(none)"];
  }

  return value.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
}

function formatTestCase(testCase: UnknownRecord): string {
  const tagNames = readTagNames(testCase.tags);

  const lines = [
    `Title: ${readString(testCase.title) ?? "N/A"}`,
    `Test Case ID: ${readString(testCase.test_case_id) ?? "N/A"}`,
    `Internal ID: ${readString(testCase.internal_id) ?? "N/A"}`,
    `External ID: ${readString(testCase.external_id) ?? "N/A"}`,
    `Project ID: ${readString(testCase.project_id) ?? "N/A"}`,
    `Folder ID: ${readString(testCase.folder_id) ?? "N/A"}`,
    `Folder Path: ${formatPath(testCase.path)}`,
    `Description: ${readString(testCase.description) ?? "N/A"}`,
    `Priority: ${readString(testCase.priority) ?? "N/A"}`,
    `Type: ${readString(testCase.type) ?? "N/A"}`,
    `Status: ${readString(testCase.status) ?? "N/A"}`,
    `Automation Status: ${readString(testCase.automation_status) ?? "N/A"}`,
    `Preconditions: ${readString(testCase.preconditions) ?? "N/A"}`,
    `Estimated Time: ${readNumber(testCase.estimated_time) ?? "N/A"}`,
    "Tags:",
    ...(tagNames.length > 0 ? tagNames.map((tag) => `- ${tag}`) : ["- (none)"]),
    `Attachments: ${formatAttachmentsInline(testCase.attachments) ?? "(none)"}`,
    `Total Steps: ${readNumber(testCase.total_steps) ?? "N/A"}`,
    "Test Steps:",
    ...formatTestSteps(testCase.test_steps),
    "BDD Scenarios:",
    ...formatBddScenarios(testCase.bdd_scenarios),
    "Dynamic Fields:",
    ...formatDynamicFields(testCase.dynamic_field_details),
    "Jira Links:",
    ...formatJiraDetails(testCase.jira_details),
    `Version: ${readNumber(testCase.version) ?? "N/A"}`,
    // The update tool (PUT /api/v2/test-cases) requires this exact value in
    // its request body - it must be fetched fresh via this tool right before
    // an update, not cached, since it changes whenever the test case does.
    `Snapshot ID: ${readString(testCase.snapshot_id) ?? "N/A"}`,
    `Created At: ${readString(testCase.created_at) ?? "N/A"}`,
    `Updated At: ${readString(testCase.updated_at) ?? "N/A"}`,
  ];

  return lines.join("\n");
}

export function registerGetTestCaseByIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_testCaseById",
    {
      title: "Get Test Manager Test Case by ID",
      description:
        "Retrieves the full details of a single LambdaTest Test Manager test case by its exact test " +
        "case ID: title, description, priority, status, preconditions, tags, attachments (both the " +
        "test case's own and each step's own, shown with their file_key for reuse with " +
        "tm.update_testCase), test steps, BDD scenarios, dynamic fields, Jira links, folder path, and " +
        "its current snapshot_id. Use this " +
        "when the test case ID is already known, to inspect its full content, or as a required first " +
        "step before updating it with tm.update_testCase - that endpoint requires the snapshot_id " +
        "returned here, fetched fresh (not cached) immediately before the update. Do not use this to " +
        "search or list test cases.",
      inputSchema,
    },
    async ({ test_case_id }) => {
      try {
        const response = await client.get(endpoints.testCases.getById(test_case_id));
        const testCase = unwrapData(response);

        if (!readString(testCase?.title)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Test case not found: no test case exists with ID "${test_case_id}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatTestCase(testCase) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, test_case_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, testCaseId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 404) {
      return `Test case not found: no test case exists with ID "${testCaseId}".`;
    }

    if (status === 422) {
      return `Could not retrieve test case: invalid test case ID "${testCaseId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve test case "${testCaseId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
