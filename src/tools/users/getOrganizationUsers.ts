import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { endpoints } from "../../config/endpoints.js";
import { readNumber, readString, unwrapDataArray, type UnknownRecord } from "../../utils/response.js";
import type { LambdaTestClient } from "../../client.js";

// One compact line per user - an organization's user list can run well over
// a hundred entries, so each user gets a single line rather than a
// multi-line block. `id` is the numeric user ID needed for `assignee` on
// tm.add_testCasesToTestRun and similar tools.
function formatUser(user: UnknownRecord): string {
  const id = readNumber(user.id);
  const name = readString(user.name) ?? "N/A";
  const email = readString(user.email) ?? "N/A";
  const role = readString(user.role) ?? "N/A";
  const groupName = readString((user.group as UnknownRecord | undefined)?.name);
  const tmsEnabled = (user.user_access_attributes as UnknownRecord | undefined)?.TMS_ACCESS_ENABLED === true;

  return (
    `${id ?? "N/A"} | ${name} <${email}> | role: ${role}` +
    (groupName ? ` | group: ${groupName}` : "") +
    ` | TMS access: ${tmsEnabled ? "yes" : "no"}`
  );
}

export function registerGetOrganizationUsersTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_organizationUsers",
    {
      title: "Get Organization Users",
      description:
        "Lists every user in the LambdaTest organization/account, with their numeric user ID, name, " +
        "email, role, group, and whether they have Test Manager (TMS) access enabled. Use this to " +
        "look up a user's ID before assigning them via the `assignee` field on " +
        "tm.add_testCasesToTestRun or similar tools. This calls an undocumented endpoint on a " +
        "different LambdaTest service (auth.lambdatest.com, not the Test Manager API) sourced from " +
        "the browser network inspector. Read-only; does not modify anything.",
      inputSchema: {},
    },
    async () => {
      try {
        const response = await client.get(endpoints.organization.listUsers);
        const users = unwrapDataArray(response);

        if (users.length === 0) {
          return { content: [{ type: "text", text: "No users found in this organization." }] };
        }

        const text = `Organization Users (${users.length}):\n\n` + users.map(formatUser).join("\n");
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const rawMessage = (error.response?.data as { message?: unknown } | undefined)?.message;
    const apiMessage = typeof rawMessage === "string" ? rawMessage : rawMessage ? JSON.stringify(rawMessage) : undefined;

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve organization users: ${error instanceof Error ? error.message : "Unknown error"}`;
}
