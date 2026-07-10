import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData } from "../../utils/response.js";

// `tags` is a genuinely variable-length list: zero, one, or many tags are
// all valid, and there is no fixed count to validate against. Omitting the
// field entirely defaults to an empty array rather than requiring it.
const inputSchema = {
  name: z.string().trim().min(1, "name is required"),
  description: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1, "tag must not be empty")).optional().default([]),
};

type CreateProjectInput = {
  name: string;
  description?: string;
  tags: string[];
};

// Confirms creation using the fields we sent plus the ID the API assigned.
// The API's create response only returns { message, type, id } - it doesn't
// echo back the project details - so we build the confirmation from the
// input rather than trying to re-derive it from the response.
function formatCreatedProject(projectId: string, input: CreateProjectInput): string {
  const lines = [
    "Project Created Successfully",
    `Project ID: ${projectId}`,
    `Project Name: ${input.name}`,
    `Description: ${input.description ?? "N/A"}`,
    "Tags:",
  ];

  lines.push(...(input.tags.length > 0 ? input.tags.map((tag) => `- ${tag}`) : ["- (none)"]));

  return lines.join("\n");
}

export function registerCreateProjectTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.create_project",
    {
      title: "Create Test Manager Project",
      description:
        "Creates a new LambdaTest Test Manager project with a name, an optional description, " +
        "and any number of tags (zero or more). Use this when the user wants to start a new " +
        "project to organize test cases in. Do not use this to update an existing project, " +
        "and do not call it speculatively - creating a project is a real, persistent action.",
      inputSchema,
    },
    async (input) => {
      try {
        const response = await client.post(endpoints.projects.create, {
          name: input.name,
          description: input.description,
          tags: input.tags,
        });
        const result = unwrapData(response);

        const projectId = readString(result?.id);
        if (!projectId) {
          return {
            isError: true,
            content: [{ type: "text", text: `Project creation did not return an ID for "${input.name}".` }],
          };
        }

        return {
          content: [{ type: "text", text: formatCreatedProject(projectId, input) }],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, input.name) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, projectName: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 422) {
      return `Could not create project "${projectName}": ${apiMessage ?? "the request was invalid."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to create project "${projectName}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
