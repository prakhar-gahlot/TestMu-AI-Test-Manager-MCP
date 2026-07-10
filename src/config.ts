import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  LT_USERNAME: z.string().min(1, "LT_USERNAME is required"),
  LT_ACCESS_KEY: z.string().min(1, "LT_ACCESS_KEY is required"),
  LT_TM_BASE_URL: z.string().url().default("https://test-manager-api.lambdatest.com"),
  // The LambdaTest account/org ID (not Jira-specific) - used as the "org_id"
  // half of the Jira-link API's "org_id:jira_issue_id" format. Optional at
  // the config level since it's only needed by tm.link_jiraIssue - the rest
  // of the server should still start without it.
  LT_ORG_ID: z.string().min(1).optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  testManager: {
    username: parsedEnv.data.LT_USERNAME,
    accessKey: parsedEnv.data.LT_ACCESS_KEY,
    baseUrl: parsedEnv.data.LT_TM_BASE_URL,
    orgId: parsedEnv.data.LT_ORG_ID,
  },
} as const;
