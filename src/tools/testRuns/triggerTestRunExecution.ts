import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString, unwrapData, type UnknownRecord } from "../../utils/response.js";

const inputSchema = {
  test_run_id: z.string().trim().min(1, "test_run_id is required"),
  concurrency: z.number().int().positive().optional(),
  title: z.string().trim().optional(),
  console_log: z.union([z.boolean(), z.enum(["error", "warn", "info"])]).optional(),
  network_logs: z.boolean().optional(),
  network_full_har: z.boolean().optional(),
  region: z.enum(["eastus", "centralindia"]).optional(),
  mobile_region: z.enum(["us", "eu", "ap"]).optional(),
  // Mutually exclusive per the API - only one of these three should be set.
  tunnel: z.string().trim().optional(),
  dedicated_proxy: z.string().trim().optional(),
  geolocation: z.string().trim().optional(),
  environment_id: z.number().int().positive().optional(),
  retry_on_failure: z.boolean().optional(),
  max_retries: z.number().int().nonnegative().optional(),
  timezone: z.object({ region: z.string().trim().min(1) }).optional(),
  app_profiling: z.boolean().optional(),
  performance: z.boolean().optional(),
  android_app_id: z.string().trim().optional(),
  ios_app_id: z.string().trim().optional(),
  accessibility: z.boolean().optional(),
  network_throttle: z
    .object({
      label: z.string().optional(),
      value: z.string().optional(),
      download_speed: z.number().optional(),
      upload_speed: z.number().optional(),
      latency: z.number().optional(),
      honor_network: z.boolean().optional(),
    })
    .optional(),
  replaced_url: z
    .array(z.object({ pattern_url: z.string().trim().min(1), replacement_url: z.string().trim().min(1) }))
    .optional(),
  report_enabled: z.boolean().optional(),
  extent_report_enabled: z.boolean().optional(),
  report_email_to: z.array(z.string().trim().email()).max(10, "report_email_to accepts at most 10 addresses").optional(),
};

type Input = {
  test_run_id: string;
  concurrency?: number;
  title?: string;
  console_log?: boolean | "error" | "warn" | "info";
  network_logs?: boolean;
  network_full_har?: boolean;
  region?: "eastus" | "centralindia";
  mobile_region?: "us" | "eu" | "ap";
  tunnel?: string;
  dedicated_proxy?: string;
  geolocation?: string;
  environment_id?: number;
  retry_on_failure?: boolean;
  max_retries?: number;
  timezone?: { region: string };
  app_profiling?: boolean;
  performance?: boolean;
  android_app_id?: string;
  ios_app_id?: string;
  accessibility?: boolean;
  network_throttle?: UnknownRecord;
  replaced_url?: { pattern_url: string; replacement_url: string }[];
  report_enabled?: boolean;
  extent_report_enabled?: boolean;
  report_email_to?: string[];
};

function formatResult(submittedRunId: string, result: UnknownRecord): string {
  const newRunId = readString(result.test_run_id);
  const jobId = readString(result.job_id);
  const jobLink = readString(result.job_link);
  const mobileJobLink = readString(result.mobile_job_link);
  const appJobId = readString(result.app_job_id);

  const lines = [
    "Test Run Execution Triggered",
    `Job ID: ${jobId ?? "N/A"}`,
    `Job Link: ${jobLink ?? "N/A"}`,
  ];

  if (mobileJobLink) {
    lines.push(`Mobile Job Link: ${mobileJobLink}`);
  }
  if (appJobId) {
    lines.push(`App Job ID: ${appJobId}`);
  }

  lines.push(
    "",
    `New Execution Run ID: ${newRunId ?? "N/A"}`,
    `(Submitted Template Run ID: ${submittedRunId} - this stays "Not Started" and unchanged; it is NOT ` +
      "where results appear.)",
    "",
    `Use tm.get_hyperExecuteJobById with the Job ID above to track progress, and ` +
      `tm.get_testCaseInstancesByTestRunId/tm.get_testRunById with the New Execution Run ID above ` +
      "(not the submitted one) once it completes.",
  );

  return lines.join("\n");
}

export function registerTriggerTestRunExecutionTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.trigger_testRunExecution",
    {
      title: "Trigger Test Run Execution on HyperExecute",
      description:
        "Dispatches a Test Manager test run's test cases to HyperExecute for REAL execution - this " +
        "is what actually starts automation running (creating a test run and adding test cases to " +
        "it only prepares the composition; nothing runs until this is called).\n" +
        "Input: test_run_id (required). Everything else is optional: concurrency (parallel workers, " +
        "default 1), title (build name), console_log (false/true/'error'/'warn'/'info'), " +
        "network_logs, network_full_har, region ('eastus'/'centralindia', web only), mobile_region " +
        "('us'/'eu'/'ap', mobile only), tunnel/dedicated_proxy/geolocation (mutually exclusive - use " +
        "at most one), environment_id, retry_on_failure (default true) with max_retries (default " +
        "1), timezone ({region}), app_profiling, performance (Lighthouse report), " +
        "android_app_id/ios_app_id, accessibility, network_throttle, replaced_url (dynamic URL " +
        "substitution), report_enabled/extent_report_enabled, and report_email_to (max 10 " +
        "addresses).\n" +
        "IMPORTANT: the test_run_id you submit is treated as a TEMPLATE - it stays 'Not Started' " +
        "and unchanged. The response returns a DIFFERENT, freshly created test_run_id holding the " +
        "actual execution - always use that one (not the one you submitted) to check results. Only " +
        "test cases whose own is_auteur_generated matches the run's type will actually execute (see " +
        "tm.add_testCasesToTestRun) - this endpoint does not validate that itself.\n" +
        "DANGER: this is a real, resource-consuming action that spins up actual HyperExecute cloud " +
        "infrastructure - do not call speculatively. Confirm the test run and its composition are " +
        "correct first (tm.get_testRunById) before triggering.",
      inputSchema,
    },
    async ({
      test_run_id,
      concurrency,
      title,
      console_log,
      network_logs,
      network_full_har,
      region,
      mobile_region,
      tunnel,
      dedicated_proxy,
      geolocation,
      environment_id,
      retry_on_failure,
      max_retries,
      timezone,
      app_profiling,
      performance,
      android_app_id,
      ios_app_id,
      accessibility,
      network_throttle,
      replaced_url,
      report_enabled,
      extent_report_enabled,
      report_email_to,
    }: Input) => {
      try {
        const scopingFields = [tunnel, dedicated_proxy, geolocation].filter((value) => value !== undefined);
        if (scopingFields.length > 1) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "tunnel, dedicated_proxy, and geolocation are mutually exclusive - provide at most one.",
              },
            ],
          };
        }

        const body: UnknownRecord = { test_run_id };
        if (concurrency !== undefined) body.concurrency = concurrency;
        if (title !== undefined) body.title = title;
        if (console_log !== undefined) body.console_log = console_log;
        if (network_logs !== undefined) body.network_logs = network_logs;
        if (network_full_har !== undefined) body.network_full_har = network_full_har;
        if (region !== undefined) body.region = region;
        if (mobile_region !== undefined) body.mobile_region = mobile_region;
        if (tunnel !== undefined) body.tunnel = tunnel;
        if (dedicated_proxy !== undefined) body.dedicated_proxy = dedicated_proxy;
        if (geolocation !== undefined) body.geolocation = geolocation;
        if (environment_id !== undefined) body.environment_id = environment_id;
        if (retry_on_failure !== undefined) body.retry_on_failure = retry_on_failure;
        if (max_retries !== undefined) body.max_retries = max_retries;
        if (timezone !== undefined) body.timezone = timezone;
        if (app_profiling !== undefined) body.app_profiling = app_profiling;
        if (performance !== undefined) body.performance = performance;
        if (android_app_id !== undefined) body.android_app_id = android_app_id;
        if (ios_app_id !== undefined) body.ios_app_id = ios_app_id;
        if (accessibility !== undefined) body.accessibility = accessibility;
        if (network_throttle !== undefined) body.network_throttle = network_throttle;
        if (replaced_url !== undefined) body.replaced_url = replaced_url;
        if (report_enabled !== undefined) body.report_enabled = report_enabled;
        if (extent_report_enabled !== undefined) body.extent_report_enabled = extent_report_enabled;
        if (report_email_to !== undefined) body.report_email_to = report_email_to;

        const response = await client.post(endpoints.testRuns.trigger, body);
        const result = unwrapData(response);

        if (!readString(result?.job_id)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Trigger request for test run "${test_run_id}" did not return a job_id (unexpected empty response).`,
              },
            ],
          };
        }

        return { content: [{ type: "text", text: formatResult(test_run_id, result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, test_run_id) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, testRunId: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = (error.response?.data as { message?: string } | undefined)?.message;

    if (status === 404) {
      return `Test run not found: no test run exists with ID "${testRunId}"${apiMessage ? `: ${apiMessage}` : "."}`;
    }

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to trigger execution for test run "${testRunId}": ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
