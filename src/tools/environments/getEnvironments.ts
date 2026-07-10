import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { formatPaginationFooter, readNumber, readString, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().optional(),
  browser: z.string().trim().optional(),
  os: z.string().trim().optional(),
  platform: z.string().trim().optional(),
  resolution: z.string().trim().optional(),
  include_run_count: z.boolean().optional(),
};

// Each top-level entry is a named config; its own `id` is the value that's
// actually usable as `environment_id` on tm.add_testCasesToTestRun /
// tm.update_testCaseInstance. The nested `environments` array's own
// `environment_id` field is a DIFFERENT, catalog-internal identifier that is
// NOT usable there, despite the identical field name - deliberately not
// surfaced here to avoid repeating that mistake.
function flattenGroups(groups: UnknownRecord[]): UnknownRecord[] {
  const rows: UnknownRecord[] = [];
  for (const group of groups) {
    const environments = Array.isArray(group.environments) ? (group.environments as UnknownRecord[]) : [];
    for (const env of environments) {
      rows.push({ ...env, usable_environment_id: group.id, run_count: group.run_count });
    }
  }
  return rows;
}

function formatEnvironment(env: UnknownRecord, index: number): string {
  const browser = readString(env.browser);
  const browserVersion = readString(env.browser_version);
  const os = readString(env.os) ?? readString(env.os_name);
  const osVersion = readString(env.os_version);
  const device = readString(env.device);
  const runCount = readNumber(env.run_count);

  const parts = [
    browser && `${browser}${browserVersion ? ` ${browserVersion}` : ""}`,
    os && `${os}${osVersion && osVersion !== os ? ` (${osVersion})` : ""}`,
    device,
    readString(env.resolution),
    readString(env.platform),
  ].filter((part): part is string => Boolean(part));

  return (
    `${index + 1}. environment_id: ${readNumber(env.usable_environment_id) ?? "N/A"} | ${readString(env.name) ?? "N/A"}` +
    ` | ${parts.length > 0 ? parts.join(", ") : "N/A"}` +
    (runCount !== undefined ? ` | used in ${runCount} run(s)` : "")
  );
}

export function registerGetEnvironmentsTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_environments",
    {
      title: "Get Test Manager Environments",
      description:
        "Lists environment configurations (browser/OS/device/resolution combinations) available in " +
        "this LambdaTest organization, org-wide rather than scoped to a single project. Each entry's " +
        "`environment_id` in this tool's output IS a valid value to pass as `environment_id` on " +
        "tm.add_testCasesToTestRun/tm.update_testCaseInstance. Supports pagination (page, per_page), " +
        "filtering by browser, os, platform, and/or resolution, and include_run_count to show how many " +
        "test runs already use each config. This can be a large list, so use the filters to narrow it " +
        "down rather than paging through everything. Read-only; does not modify anything.",
      inputSchema,
    },
    async ({ page, per_page, browser, os, platform, resolution, include_run_count }) => {
      try {
        const response = await client.get(endpoints.environments.list, {
          params: {
            page,
            per_page,
            "filter[browser]": browser,
            "filter[os]": os,
            "filter[platform]": platform,
            "filter[resolution]": resolution,
            "filter[include_run_count]": include_run_count,
          },
        });
        const groups = Array.isArray((response as UnknownRecord | undefined)?.data)
          ? ((response as UnknownRecord).data as UnknownRecord[])
          : [];
        const environments = flattenGroups(groups);

        if (environments.length === 0) {
          return { content: [{ type: "text", text: "No environments match this query." }] };
        }

        const footer = formatPaginationFooter(response, "environment");
        const text = environments.map(formatEnvironment).join("\n") + (footer ? `\n\n${footer}` : "");

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
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to retrieve environments: ${error instanceof Error ? error.message : "Unknown error"}`;
}
