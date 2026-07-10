import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readAttachmentFileKeys, readString, readTagNames, unwrapData, type UnknownRecord } from "../../utils/response.js";

// A new step to append. Only ADDING steps is supported - modifying or
// deleting existing steps is intentionally out of scope for this tool.
// `attachments` (if given) are file_key values from tm.upload_attachment -
// upload the file first, then pass its file_key here.
const newStepSchema = z.object({
  description: z.string().trim().min(1, "step description is required"),
  outcome: z.string().trim().optional(),
  attachments: z.array(z.string().trim().min(1, "attachment file_key must not be empty")).optional(),
});

// Every field besides `test_case_id` is optional - only the ones provided
// get changed; everything else is carried over unchanged from the test
// case's current state (fetched fresh via tm.get_testCaseById's endpoint
// right before the update, per the API's snapshot_id requirement).
const inputSchema = {
  test_case_id: z.string().trim().min(1, "test_case_id is required"),
  title: z.string().trim().min(1, "title must not be empty if provided").optional(),
  description: z.string().trim().optional(),
  priority: z.string().trim().optional(),
  status: z.string().trim().optional(),
  automation_status: z.string().trim().optional(),
  preconditions: z.string().trim().optional(),
  external_id: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1, "tag must not be empty")).optional(),
  attachments: z.array(z.string().trim().min(1, "attachment file_key must not be empty")).optional(),
  new_steps: z.array(newStepSchema).optional(),
  commit_message: z.string().trim().optional(),
};

type NewStep = z.infer<typeof newStepSchema>;

// Builds ADD-only step_events, chaining each new step after the last
// existing step (or after the previously added one), so multiple new steps
// append in order at the end rather than all competing for the same
// position. `test_step_info_id` is a caller-generated ID for a step that
// doesn't exist yet - the API assigns the real one once created.
function buildAddStepEvents(newSteps: NewStep[], existingSteps: UnknownRecord[]): UnknownRecord[] {
  let previousStepId = existingSteps.length > 0 ? readString(existingSteps[existingSteps.length - 1]?.id) : undefined;

  return newSteps.map((step) => {
    const stepId = `custom-${randomUUID()}`;
    const event: UnknownRecord = {
      test_step_info_id: stepId,
      step_type: "step",
      operation: "ADD",
      description: step.description,
      outcome: step.outcome ?? "",
      attachments: step.attachments ?? [],
    };
    if (previousStepId) {
      event.parent_step_info_id = previousStepId;
    }
    previousStepId = stepId;
    return event;
  });
}

// Preserves the project's dynamic field values as-is, since this tool
// doesn't support editing them - the PUT replaces the whole record, so
// omitting them here would risk wiping out values that were never meant to
// change.
function preserveDynamicFields(current: UnknownRecord): UnknownRecord[] {
  const details = Array.isArray(current.dynamic_field_details) ? (current.dynamic_field_details as UnknownRecord[]) : [];

  return details.map((field) => ({
    field_id: readString(field.field_id) ?? "",
    value: readString(field.value) ?? "",
  }));
}

function formatUpdateResult(
  testCaseId: string,
  snapshotId: string,
  merged: { title: string; priority: string; status: string; automationStatus: string; tags: string[]; attachments: string[] },
  addedSteps: NewStep[],
): string {
  const lines = [
    "Test Case Updated Successfully",
    `Test Case ID: ${testCaseId}`,
    `Title: ${merged.title}`,
    `Priority: ${merged.priority}`,
    `Status: ${merged.status}`,
    `Automation Status: ${merged.automationStatus}`,
    "Tags:",
    ...(merged.tags.length > 0 ? merged.tags.map((tag) => `- ${tag}`) : ["- (none)"]),
    `Attachments: ${merged.attachments.length > 0 ? merged.attachments.join(", ") : "(none)"}`,
  ];

  if (addedSteps.length > 0) {
    lines.push(`Steps Added: ${addedSteps.length}`);
    lines.push(...addedSteps.map((step, index) => `  ${index + 1}. ${step.description}`));
  } else {
    lines.push("Steps Added: 0");
  }

  lines.push(`New Snapshot ID: ${snapshotId}`);

  return lines.join("\n");
}

export function registerUpdateTestCaseTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.update_testCase",
    {
      title: "Update Test Manager Test Case",
      description:
        "Updates a LambdaTest Test Manager test case's metadata (title, description, priority, " +
        "status, automation_status, preconditions, external_id, tags, attachments) and/or appends " +
        "new steps to it. Only the fields you provide are changed - everything else is left as-is. " +
        "attachments (if provided) REPLACES the test case's whole attachment list - use " +
        "tm.upload_attachment first to get a file_key, then pass one or more file_keys here; if " +
        "omitted, existing attachments are left untouched. new_steps can each optionally carry their " +
        "own attachments (same file_key values) for a fresh step. Only ADDING new steps is supported " +
        "(appended after existing ones); this tool cannot modify or delete existing steps (including " +
        "their attachments), edit BDD scenarios, or edit dynamic fields. Internally fetches the test " +
        "case's current snapshot_id right before updating, as required by the API. Requires at " +
        "least one field or new_steps entry to actually change. Do not call this speculatively - " +
        "updating a test case is a real, persistent action.",
      inputSchema,
    },
    async (input) => {
      const hasChange =
        input.title !== undefined ||
        input.description !== undefined ||
        input.priority !== undefined ||
        input.status !== undefined ||
        input.automation_status !== undefined ||
        input.preconditions !== undefined ||
        input.external_id !== undefined ||
        input.tags !== undefined ||
        input.attachments !== undefined ||
        (input.new_steps !== undefined && input.new_steps.length > 0);

      if (!hasChange) {
        return {
          isError: true,
          content: [{ type: "text", text: "No changes provided: pass at least one field to update or new_steps to add." }],
        };
      }

      try {
        const currentResponse = await client.get(endpoints.testCases.getById(input.test_case_id));
        const current = unwrapData(currentResponse);

        if (!readString(current?.title)) {
          return {
            isError: true,
            content: [
              { type: "text", text: `Test case not found: no test case exists with ID "${input.test_case_id}".` },
            ],
          };
        }

        const snapshotId = readString(current.snapshot_id);
        if (!snapshotId) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Cannot update test case "${input.test_case_id}": the API did not return a snapshot_id to update against.`,
              },
            ],
          };
        }

        const existingSteps = Array.isArray(current.test_steps) ? (current.test_steps as UnknownRecord[]) : [];
        const stepEvents = buildAddStepEvents(input.new_steps ?? [], existingSteps);

        const merged = {
          title: input.title ?? readString(current.title) ?? "",
          description: input.description ?? readString(current.description) ?? "",
          priority: input.priority ?? readString(current.priority) ?? "",
          status: input.status ?? readString(current.status) ?? "",
          automationStatus: input.automation_status ?? readString(current.automation_status) ?? "",
          preconditions: input.preconditions ?? readString(current.preconditions) ?? "",
          externalId: input.external_id ?? readString(current.external_id) ?? "",
          tags: input.tags ?? readTagNames(current.tags),
          attachments: input.attachments ?? readAttachmentFileKeys(current.attachments),
        };

        const body = {
          id: input.test_case_id,
          project_id: readString(current.project_id) ?? "",
          title: merged.title,
          description: merged.description,
          type: readString(current.type) ?? "",
          preconditions: merged.preconditions,
          status: merged.status,
          priority: merged.priority,
          automation_status: merged.automationStatus,
          external_id: merged.externalId,
          attachments: merged.attachments,
          dynamic_fields: preserveDynamicFields(current),
          tags: merged.tags,
          commit_message: input.commit_message ?? "Updated via LambdaTest Test Manager MCP server",
          snapshot_id: snapshotId,
          step_events: stepEvents,
          override: false,
        };

        const response = await client.put(endpoints.testCases.update, body);
        const result = unwrapData(response);
        const newSnapshotId = readString(result?.snapshot_id) ?? snapshotId;

        return {
          content: [
            { type: "text", text: formatUpdateResult(input.test_case_id, newSnapshotId, merged, input.new_steps ?? []) },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, input.test_case_id) }] };
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

    if (status === 422) {
      return `Could not update test case "${testCaseId}": ${apiMessage ?? "the request was invalid, or the snapshot_id is out of date (someone else may have updated it since)."}`;
    }

    if (status === 404) {
      return `Test case not found: no test case exists with ID "${testCaseId}".`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to update test case "${testCaseId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
