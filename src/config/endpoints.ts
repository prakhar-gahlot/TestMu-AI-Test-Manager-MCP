/**
 * Centralized registry of LambdaTest Test Manager API endpoint paths.
 *
 * Every value here is a RELATIVE path only - the base URL is applied by the
 * shared Axios client (see ../client.ts), which resolves it from environment
 * configuration (see ../config.ts). No tool or service should build a path
 * string inline; import it from here instead, so each route only ever needs
 * to change in one place.
 *
 * Dynamic paths are functions that interpolate their parameters (and encode
 * them) internally, so callers never do string concatenation themselves.
 */
export const endpoints = {
  projects: {
    // GET /api/v1/projects/{project_id}
    getById: (projectId: string): string => `/api/v1/projects/${encodeURIComponent(projectId)}`,
    // POST /api/v1/projects
    create: "/api/v1/projects",
  },
  folders: {
    // GET /api/v1/folder/entity/{entity_id} - entity_id is the project ID.
    // This is the TEST CASE folder tree - see testRunFolders below for the
    // completely separate test-run folder tree.
    listByProjectId: (projectId: string): string =>
      `/api/v1/folder/entity/${encodeURIComponent(projectId)}`,
    // POST /api/v1/folder
    create: "/api/v1/folder",
  },
  testRunFolders: {
    // GET /api/v1/folder/test-run/entity/{project_id} - undocumented (sourced
    // from the browser network inspector). The test-run folder tree, entirely
    // separate from the test-case folder tree above despite the similar path
    // and response shape.
    listByProjectId: (projectId: string): string =>
      `/api/v1/folder/test-run/entity/${encodeURIComponent(projectId)}`,
    // POST /api/v1/folder/test-run - undocumented (sourced from the browser
    // network inspector).
    create: "/api/v1/folder/test-run",
  },
  testCases: {
    // GET /api/v1/projects/{project_id}/folder/{folder_id}/test-cases
    listByFolderId: (projectId: string, folderId: string): string =>
      `/api/v1/projects/${encodeURIComponent(projectId)}/folder/${encodeURIComponent(folderId)}/test-cases`,
    // GET /api/v1/projects/{project_id}/test-cases
    listByProjectId: (projectId: string): string =>
      `/api/v1/projects/${encodeURIComponent(projectId)}/test-cases`,
    // POST /api/v1/test-cases
    create: "/api/v1/test-cases",
    // GET /api/v2/test-cases/{test_case_id}
    getById: (testCaseId: string): string => `/api/v2/test-cases/${encodeURIComponent(testCaseId)}`,
    // PUT /api/v2/test-cases
    update: "/api/v2/test-cases",
  },
  executionHistory: {
    // GET /api/v1/test-execution-history/{test_case_id}
    getByTestCaseId: (testCaseId: string): string =>
      `/api/v1/test-execution-history/${encodeURIComponent(testCaseId)}`,
    // GET /api/v1/test-execution-history/jira/{Jira_issue_id}
    getByJiraId: (jiraIssueId: string): string =>
      `/api/v1/test-execution-history/jira/${encodeURIComponent(jiraIssueId)}`,
  },
  jira: {
    // POST /api/v1/jira
    link: "/api/v1/jira",
    // POST /api/v1/jira/remove
    remove: "/api/v1/jira/remove",
  },
  testRuns: {
    // GET /api/v1/test-run/{test_run_id}
    getById: (testRunId: string): string => `/api/v1/test-run/${encodeURIComponent(testRunId)}`,
    // GET /api/v1/test-run/instances/{test_run_id}
    getInstancesById: (testRunId: string): string =>
      `/api/v1/test-run/instances/${encodeURIComponent(testRunId)}`,
    // PUT /api/v1/test-run/status/{test_run_id} - undocumented, sourced from
    // browser inspector rather than the OpenAPI docs.
    updateStatus: (testRunId: string): string => `/api/v1/test-run/status/${encodeURIComponent(testRunId)}`,
    // GET /api/v1/test-run/test-run-instance/{test_instance_id} - test_instance_id
    // is numeric, distinct from test_case_id.
    getInstanceById: (testInstanceId: string): string =>
      `/api/v1/test-run/test-run-instance/${encodeURIComponent(testInstanceId)}`,
    // GET /api/v1/projects/{project_id}/test-runs
    listByProjectId: (projectId: string): string =>
      `/api/v1/projects/${encodeURIComponent(projectId)}/test-runs`,
    // POST /api/v1/test-run
    create: "/api/v1/test-run",
    // PUT /api/v1/test-run/{test_run_id} - full replace: title/objective/tags/
    // type/is_auteur_generated AND the entire test_run_instances list (see
    // addTestCasesToTestRun.ts for why callers must fetch-merge-then-PUT).
    update: (testRunId: string): string => `/api/v1/test-run/${encodeURIComponent(testRunId)}`,
    // PUT /api/v1/test-run/instance/{test_instance_id} - undocumented (sourced
    // from the browser network inspector), partial update of ONE instance
    // (status/assignee/environment_id/remarks) without touching the rest of
    // the run's test_run_instances list.
    updateInstance: (testInstanceId: string): string =>
      `/api/v1/test-run/instance/${encodeURIComponent(testInstanceId)}`,
    // PUT /api/v1/test-run/test-run-step/{test_run_step_id} - updates ONE
    // step's own status/remarks/attachment_urls, distinct from the instance
    // as a whole. test_run_step_id is the step's own numeric `id` (from
    // test_build_steps), not the instance ID.
    updateStep: (testRunStepId: string): string =>
      `/api/v1/test-run/test-run-step/${encodeURIComponent(testRunStepId)}`,
    // PUT /api/v1/test-run/{test_run_id}/bulk-update - updates MULTIPLE
    // instances (by their own numeric id) in a single call, each with its
    // own status/assignee - distinct from both the whole-run-replace PUT
    // (update, above) and the single-instance PUT (updateInstance, above).
    bulkUpdateInstances: (testRunId: string): string =>
      `/api/v1/test-run/${encodeURIComponent(testRunId)}/bulk-update`,
    // POST /api/atm/v1/hyperexecute - user-supplied curl sample (a documented
    // LambdaTest endpoint, distinct from every other undocumented test-run
    // endpoint above). Dispatches the given test_run_id's test cases to
    // HyperExecute for REAL execution - a genuinely mutating, resource-
    // consuming action (spins up real cloud infrastructure), unlike every
    // other "test run" tool in this file, which only ever touches metadata.
    // CONFIRMED LIVE: the test_run_id you submit is treated as a template -
    // the response's own `test_run_id` field is a DIFFERENT, freshly created
    // run holding the actual execution results; the submitted run stays
    // "Not Started" and untouched. Callers must poll/inspect the run ID from
    // the RESPONSE, not the one they sent. Only test cases whose own
    // is_auteur_generated matches the run's (see tm.add_testCasesToTestRun)
    // will execute - the request itself doesn't validate this, per
    // established behavior throughout this API family.
    trigger: "/api/atm/v1/hyperexecute",
  },
  organization: {
    // GET https://auth.lambdatest.com/api/organization/users?allUsers=true
    // Undocumented (sourced from the browser network inspector, not the
    // OpenAPI docs) AND on a completely different host than everything else
    // in this file (LambdaTest's auth/account API, not Test Manager) - this
    // is the one deliberate exception to "every value here is a relative
    // path". Axios follows an absolute URL as-is regardless of the client's
    // configured baseURL, so no client changes were needed to support it.
    listUsers: "https://auth.lambdatest.com/api/organization/users?allUsers=true",
  },
  environments: {
    // GET /api/v1/environments - org-wide, not project-scoped.
    list: "/api/v1/environments",
  },
  attachments: {
    // POST /api/v1/attachment - undocumented (sourced directly from the
    // user, not the OpenAPI docs). multipart/form-data upload, single field
    // named `file`. See uploadAttachment.ts for the response shape and which
    // returned field to actually use downstream.
    upload: "/api/v1/attachment",
  },
  insights: {
    // GET https://api.lambdatest.com/insights/api/v3/public/rca - a THIRD distinct
    // host (api.lambdatest.com, neither test-manager-api.lambdatest.com nor
    // auth.lambdatest.com), stored as a full absolute URL for the same reason
    // organization.listUsers is above. Officially documented (unlike almost
    // everything else in this project) and strictly better than an earlier,
    // undocumented, now-retired sibling endpoint
    // (GET /insights/api/v3/rca/{automation_test_id}): identical underlying RCA
    // content, but as a real nested object (no JSON-encoded-string field to
    // parse), and more importantly, batch-capable - accepts comma-separated
    // test_ids/job_ids/task_ids/stage_ids (at least one required; a request with
    // none returns 400), with page/limit pagination. Querying by job_ids or
    // task_ids returns RCA for every matching test execution in one call, not
    // just one. Each record also carries its own job_id/task_id/stage_id/
    // build_id directly. A passed execution, a never-executed instance, or a
    // wholly invalid ID of any type all return a clean 200 with an EMPTY data
    // array (not a 404 like the retired sibling endpoint) - confirmed live,
    // still can't distinguish "wrong ID" from "no RCA exists" but at least
    // doesn't require special-casing a 404.
    getRCA: "https://api.lambdatest.com/insights/api/v3/public/rca",
    // POST https://api.lambdatest.com/insights/api/v3/public/rca/generate - same
    // host/prefix as getRCA above, officially documented. MUTATING AND COSTS REAL
    // CREDITS: dispatches AI RCA generation for every failed test under the given
    // scope (job_ids/stage_ids/task_ids/test_ids, at least one required, JSON
    // body not query params, each array capped at 100 IDs per the docs). Tests
    // that already have RCA (or one currently in progress) are skipped and not
    // charged - confirmed live it's safe to pass a mixed batch of already-done
    // and not-yet-done test_ids, only the pending ones get dispatched/charged.
    // All-or-nothing on credits: insufficient balance returns 402 with no tests
    // dispatched at all, not a partial trigger. A scope resolving to over 10,000
    // failed tests returns 413.
    generateRCA: "https://api.lambdatest.com/insights/api/v3/public/rca/generate",
    // GET https://api.lambdatest.com/insights/api/v3/public/rca/status - same
    // host/prefix as getRCA/generateRCA above, officially documented. Meant for
    // polling after generateRCA: returns a progress summary (total/completed/
    // in_progress/failed/pending counts) for the whole scope PLUS a paginated
    // list of completed results, optionally hydrated with the full rca_detail
    // via include_detail=true (same shape as getRCA's per-record rca_detail).
    // Same scope params as getRCA/generateRCA (test_ids/job_ids/task_ids/
    // stage_ids, at least one required, each capped at 100 IDs; over 10,000
    // resolved tests returns 413) BUT pagination here is offset/limit, NOT
    // page/limit like getRCA - a real divergence between two endpoints on the
    // same API prefix. A scope matching zero tests still returns 200 with
    // all-zero progress counts and an empty results array, but ALSO includes a
    // helpful top-level `message` explaining why (e.g. IDs don't belong to the
    // org or aren't failed tests) - confirmed live, more informative than
    // getRCA's bare empty array for the same kind of empty result.
    getRCAStatus: "https://api.lambdatest.com/insights/api/v3/public/rca/status",
    // GET https://api.lambdatest.com/insights/api/v3/public/tests - same host/
    // prefix as the RCA endpoints above but a distinct "Test Data" resource, not
    // RCA-tagged. Returns paginated test execution records enriched with AI
    // insights (smart_tags, flakiness, a condensed rca {category, summary}, and
    // failure_category) plus env_config/test_metadata/build_metadata. Filters:
    // job_ids/task_ids/stage_ids/test_ids/build_ids (comma-separated), each
    // optional, but the TOTAL ID count across all five combined is capped at
    // 100 (not per-array like the RCA endpoints). Defaults to the last 7 days
    // if from_timestamp/to_timestamp are both omitted - confirmed live this
    // applies even when filtering by a specific test_id, so a real, valid
    // test_id from outside the last 7 days returns an empty result unless the
    // date range is widened explicitly (a `notes` array in the response
    // explains this when it happens). from_timestamp/to_timestamp must be
    // supplied together (one alone is a clean 400) and the max span per call
    // is 31 days (also a clean 400 if exceeded). Cursor-based pagination via
    // `cursor`/`limit`, using the previous response's own `next_cursor`.
    listTests: "https://api.lambdatest.com/insights/api/v3/public/tests",
  },
  hyperexecute: {
    // GET https://api.hyperexecute.cloud/v2.0/job/{jobID} - a FIFTH distinct host
    // in this project (api.hyperexecute.cloud - not test-manager-api.lambdatest.com,
    // auth.lambdatest.com, api.lambdatest.com, or api-hyperexecute.lambdatest.com),
    // stored as a full absolute URL for the same reason organization.listUsers and
    // insights.getRCA are above. Unlike most endpoints in this file, this ONE has an
    // official OpenAPI spec - but the real response still diverges from it:
    // `runsOn` (not the spec's `runson`), per-task `parentTaskID` (not `parentTaskId`),
    // `statusCountsExcludingRetries` (not the spec's snake_case
    // `status_counts_excluding_retries`), and several fields the spec omits entirely
    // (`config.ml_sanctum_concurrency`, `execution_time_sec`, `dynamic_allocation`,
    // `jobSummary.testStatusCount`, per-task `allocationRequestedAt`/`failedAt`).
    // A nonexistent OR malformed job ID both return the identical
    // 404 {"message":"Unable to find requested data","status":404} - confirmed live,
    // no separate validation-error shape exists.
    getJobById: (jobId: string): string =>
      `https://api.hyperexecute.cloud/v2.0/job/${encodeURIComponent(jobId)}`,
    // GET https://api.hyperexecute.cloud/v2.0/job/{jobID}/scenarios - same host as
    // getJobById above. Lists every scenario (one per test execution attempt,
    // across every Task in the job) with pagination (limit/cursor) and filtering
    // (status/search_text). Unlike getJobById's response, `taskId` here is
    // camelCase (the spec documents it the same way, for once) but `duration` is
    // a formatted "HH:MM:SS" string, not seconds - and has been observed negative
    // (e.g. "-00:00:01") on at least one real scenario, apparently a real API bug.
    // A filter (status/search_text) that matches zero scenarios returns 404
    // {"error":"No scenarios found for jobID","status":"failed"} rather than an
    // empty 200 list - distinguishable from a genuinely bad job_id, which returns
    // a DIFFERENT 404 {"error":"job not found","status":"failed"} - both confirmed
    // live, and (unlike several sibling HyperExecute/insights endpoints) these two
    // 404 cases ARE distinguishable by their `error` message text.
    getJobScenarios: (jobId: string): string =>
      `https://api.hyperexecute.cloud/v2.0/job/${encodeURIComponent(jobId)}/scenarios`,
    // GET https://api.hyperexecute.cloud/v2.0/job/{jobID}/sessions - same host and
    // pagination/filter shape as getJobScenarios above (limit/cursor/status/
    // search_text - search_text here matches against `scenario_name`, not `name`).
    // `sessionID` and `testID` have been observed identical on every entry seen so
    // far - this is the same automation_test_id used elsewhere (RCA, execution
    // history, tm.get_testCaseInstancesByTestRunId's `test_id`). Unlike
    // getJobScenarios, there is no `iteration` field - a retried test shows up as a
    // separate session entry instead of an iteration counter on one entry. A
    // zero-match filter returns 404 {"error":"no sessions found for the jobID",
    // "status":"failed"} (lowercase, differently worded from the sibling
    // scenarios endpoint's "No scenarios found for jobID" - confirmed exact text
    // differs) rather than an empty 200 list; a bad job_id returns a separate,
    // distinguishable 404 {"error":"job not found","status":"failed"}.
    getJobSessions: (jobId: string): string =>
      `https://api.hyperexecute.cloud/v2.0/job/${encodeURIComponent(jobId)}/sessions`,
    // GET https://api.hyperexecute.cloud/v1.0/jobs - same host, NOTE the different
    // API version (v1.0, not v2.0) and NO {jobID} path segment - this lists every
    // Job in the organization, not one specific job. Pagination is cursor-based on
    // `job_number` (a plain descending integer, unlike the opaque string IDs used
    // by getJobScenarios/getJobSessions's cursors) - but `cursor` only has any
    // effect when `is_cursor_base_pagination=true` is ALSO sent (confirmed live -
    // matches the spec's otherwise-odd "required: true" flag on that param, which
    // turned out to be functionally real, not a spec error). `metadata` is only
    // returned at all when cursor pagination is used; a plain first-page call
    // returns no metadata whatsoever. Each job's real (undocumented) `meta.runId`
    // field, when present, is the ORIGINATING TEST MANAGER test_run_id - confirmed
    // live against a real job/run pair investigated elsewhere in this project -
    // this is the key link for going from a Test Manager run to its HyperExecute
    // job, though there is no server-side filter by runId/job_label, so finding a
    // specific run's job still means paginating and matching meta.runId
    // client-side. Not every job has `meta` populated (non-KaneAI-triggered jobs
    // have been observed with `meta: null` or `meta: {}`).
    listJobs: "https://api.hyperexecute.cloud/v1.0/jobs",
    // GET https://api-hyperexecute.lambdatest.com/sentinel/v1.0/test/{automation_test_id}
    // - a SIXTH distinct host (api-hyperexecute.lambdatest.com - note the hyphen and
    // .com, NOT api.hyperexecute.cloud used by every other hyperexecute.* entry
    // above), undocumented (sourced from the user's browser network inspector).
    // Given an automation_test_id (the same ID already surfaced by
    // tm.get_testCaseInstancesByTestRunId's `test_id`,
    // tm.get_testExecutionHistoryByTestCaseId, tm.get_testExecutionRCA, and
    // tm.get_hyperExecuteJobSessions's sessionID/testID), returns that execution's
    // `job` (the HyperExecute job ID - this is the fast, reliable way to resolve a
    // job_id when at least one instance in a run reached a session, in contrast to
    // paginating tm.get_hyperExecuteJobs and matching meta.runId, which is slower,
    // confirmed unreliable for scheduled-run instances, and has confirmed
    // pagination bugs - see API_FINDINGS.txt), plus `task`, `stage_id`, `step`,
    // `retry`. A nonexistent automation_test_id returns a clean, distinct
    // 404 {"error":"test not found","status":"failed"}.
    getTestDetails: (automationTestId: string): string =>
      `https://api-hyperexecute.lambdatest.com/sentinel/v1.0/test/${encodeURIComponent(automationTestId)}`,
  },
};
