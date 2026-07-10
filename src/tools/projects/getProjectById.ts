import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, readTagNames, unwrapData, type UnknownRecord } from "../../utils/response.js";

// Input schema for the tool. `.trim()` normalizes whitespace before `.min(1)`
// rejects it, so " " (whitespace-only) is treated the same as "" (empty).
const inputSchema = {
  project_id: z.string().trim().min(1, "project_id is required"),
};

// Renders whatever project fields are present as plain text. Tool output is
// read by an AI agent (and often shown to a human), so a formatted block is
// more useful than a raw JSON dump.
function formatProject(project: UnknownRecord): string {
  const tagNames = readTagNames(project.tags);

  const lines = [
    `Project Name: ${readString(project.name) ?? "N/A"}`,
    `Project ID: ${readString(project.project_id) ?? "N/A"}`,
    `Description: ${readString(project.description) ?? "N/A"}`,
    `Test Cases: ${readNumber(project.test_case_count) ?? "N/A"}`,
    `Created At: ${readString(project.created_at) ?? "N/A"}`,
    `Updated At: ${readString(project.updated_at) ?? "N/A"}`,
    "Tags:",
  ];

  lines.push(...(tagNames.length > 0 ? tagNames.map((name) => `- ${name}`) : ["- (none)"]));

  return lines.join("\n");
}

/**
 * Pattern for future tools that call the LambdaTest API:
 *   1. Define the input schema with Zod (validate/normalize at the boundary).
 *   2. Build the URL from `endpoints.ts` and call it via the shared `client` -
 *      never hardcode a path string or construct axios directly in a tool.
 *   3. Don't force a strict schema onto the response - read the fields you
 *      need defensively and use the presence of a key identifying field
 *      (e.g. `name`) to decide whether the resource was actually found.
 *   4. Catch errors and return `{ isError: true, content: [...] }` instead of
 *      throwing, so a bad request/response never crashes the MCP server.
 *   5. Format success output as human-readable text, not raw JSON.
 */
export function registerGetProjectByIdTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_projectById",
    {
      title: "Get Test Manager Project by ID",
      description:
        "Retrieves a single LambdaTest Test Manager project's details by its exact project ID: " +
        "name, description, test case count, tags, and created/updated timestamps. " +
        "Use this when the project ID is already known - for example, to verify a project " +
        "exists before creating test cases in it, or to show project metadata to the user. " +
        "Do not use this to search for a project by name or to list all projects.",
      inputSchema,
    },
    async ({ project_id }) => {
      try {
        const response = await client.get(endpoints.projects.getById(project_id));
        const project = unwrapData(response);

        if (!readString(project?.name)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Project not found: no project exists with ID "${project_id}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatProject(project) }],
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

  return `Failed to retrieve project "${projectId}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
