import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LambdaTestClient } from "../client.js";
import { registerServerInfoTool } from "./serverInfo.js";

import { registerCreateProjectTool } from "./projects/createProject.js";
import { registerGetProjectByIdTool } from "./projects/getProjectById.js";

import { registerCreateFolderTool } from "./folders/createFolder.js";
import { registerGetFoldersByProjectIdTool } from "./folders/getFoldersByProjectId.js";

import { registerCreateTestCasesTool } from "./testCases/createTestCases.js";
import { registerGetTestCaseByIdTool } from "./testCases/getTestCaseById.js";
import { registerGetTestCasesByFolderIdTool } from "./testCases/getTestCasesByFolderId.js";
import { registerGetTestCasesByProjectIdTool } from "./testCases/getTestCasesByProjectId.js";
import { registerGetTestExecutionHistoryByTestCaseIdTool } from "./testCases/getTestExecutionHistoryByTestCaseId.js";
import { registerUpdateTestCaseTool } from "./testCases/updateTestCase.js";

import { registerGetTestExecutionHistoryByJiraIdTool } from "./jira/getTestExecutionHistoryByJiraId.js";
import { registerLinkJiraIssueTool } from "./jira/linkJiraIssue.js";
import { registerRemoveJiraIssueTool } from "./jira/removeJiraIssue.js";

import { registerAddTestCasesToTestRunTool } from "./testRuns/addTestCasesToTestRun.js";
import { registerBulkUpdateTestCaseInstancesTool } from "./testRuns/bulkUpdateTestCaseInstances.js";
import { registerTriggerTestRunExecutionTool } from "./testRuns/triggerTestRunExecution.js";
import { registerCreateTestRunTool } from "./testRuns/createTestRun.js";
import { registerCreateTestRunFolderTool } from "./testRuns/createTestRunFolder.js";
import { registerGetTestCaseInstanceByIdTool } from "./testRuns/getTestCaseInstanceById.js";
import { registerGetTestCaseInstancesByTestRunIdTool } from "./testRuns/getTestCaseInstancesByTestRunId.js";
import { registerGetTestRunByIdTool } from "./testRuns/getTestRunById.js";
import { registerGetTestRunFoldersByProjectIdTool } from "./testRuns/getTestRunFoldersByProjectId.js";
import { registerGetTestRunsByProjectIdTool } from "./testRuns/getTestRunsByProjectId.js";
import { registerUpdateTestCaseInstanceTool } from "./testRuns/updateTestCaseInstance.js";
import { registerUpdateTestCaseInstanceStepTool } from "./testRuns/updateTestCaseInstanceStep.js";
import { registerUpdateTestRunStatusTool } from "./testRuns/updateTestRunStatus.js";

import { registerGetEnvironmentsTool } from "./environments/getEnvironments.js";

import { registerGetOrganizationUsersTool } from "./users/getOrganizationUsers.js";

import { registerUploadAttachmentTool } from "./attachments/uploadAttachment.js";

import { registerGetTestExecutionRCATool } from "./insights/getTestExecutionRCA.js";
import { registerGenerateTestExecutionRCATool } from "./insights/generateTestExecutionRCA.js";
import { registerGetTestExecutionRCAStatusTool } from "./insights/getTestExecutionRCAStatus.js";
import { registerGetTestExecutionDataTool } from "./insights/getTestExecutionData.js";

import { registerGetHyperExecuteJobByIdTool } from "./hyperexecute/getHyperExecuteJobById.js";
import { registerGetHyperExecuteJobScenariosTool } from "./hyperexecute/getHyperExecuteJobScenarios.js";
import { registerGetHyperExecuteJobSessionsTool } from "./hyperexecute/getHyperExecuteJobSessions.js";
import { registerGetHyperExecuteJobsTool } from "./hyperexecute/getHyperExecuteJobs.js";
import { registerGetHyperExecuteTestDetailsTool } from "./hyperexecute/getHyperExecuteTestDetails.js";

/**
 * Registers all available tools on the given MCP server.
 *
 * Tools are organized into subfolders by domain (projects, folders,
 * testCases, jira, testRuns, environments, users, attachments, insights,
 * hyperexecute) - mirroring the sections in DEV_NOTES.md. To add a new tool:
 *   1. Create a new file in the matching domain folder, e.g.
 *      `tools/testRuns/listTestRuns.ts` (or a new folder if it's a new domain).
 *   2. Export a `registerListTestRunsTool(server, client)` function from it
 *      that calls `server.registerTool(...)` to define the tool's name, schema, and handler.
 *   3. Import and call it here, in the matching section below.
 */
export function registerTools(server: McpServer, client: LambdaTestClient): void {
  registerServerInfoTool(server);

  registerGetProjectByIdTool(server, client);
  registerCreateProjectTool(server, client);

  registerGetFoldersByProjectIdTool(server, client);
  registerCreateFolderTool(server, client);

  registerGetTestCasesByFolderIdTool(server, client);
  registerGetTestCasesByProjectIdTool(server, client);
  registerCreateTestCasesTool(server, client);
  registerGetTestCaseByIdTool(server, client);
  registerUpdateTestCaseTool(server, client);
  registerGetTestExecutionHistoryByTestCaseIdTool(server, client);

  registerGetTestExecutionHistoryByJiraIdTool(server, client);
  registerLinkJiraIssueTool(server, client);
  registerRemoveJiraIssueTool(server, client);

  registerGetTestRunByIdTool(server, client);
  registerGetTestCaseInstancesByTestRunIdTool(server, client);
  registerUpdateTestRunStatusTool(server, client);
  registerGetTestCaseInstanceByIdTool(server, client);
  registerGetTestRunsByProjectIdTool(server, client);
  registerCreateTestRunTool(server, client);
  registerAddTestCasesToTestRunTool(server, client);
  registerBulkUpdateTestCaseInstancesTool(server, client);
  registerTriggerTestRunExecutionTool(server, client);
  registerUpdateTestCaseInstanceTool(server, client);
  registerUpdateTestCaseInstanceStepTool(server, client);
  registerGetTestRunFoldersByProjectIdTool(server, client);
  registerCreateTestRunFolderTool(server, client);

  registerGetEnvironmentsTool(server, client);

  registerGetOrganizationUsersTool(server, client);

  registerUploadAttachmentTool(server, client);

  registerGetTestExecutionRCATool(server, client);
  registerGenerateTestExecutionRCATool(server, client);
  registerGetTestExecutionRCAStatusTool(server, client);
  registerGetTestExecutionDataTool(server, client);

  registerGetHyperExecuteJobByIdTool(server, client);
  registerGetHyperExecuteJobScenariosTool(server, client);
  registerGetHyperExecuteJobSessionsTool(server, client);
  registerGetHyperExecuteJobsTool(server, client);
  registerGetHyperExecuteTestDetailsTool(server, client);
}
