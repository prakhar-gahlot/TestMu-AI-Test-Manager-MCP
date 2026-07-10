# Contributing: Adding a New Tool

This document captures the rules this server's tools follow, so it keeps evolving consistently as
more are added. It's deliberately just rules - no narrative, no real account data, no "why we
decided X." (Design rationale and investigation history live in this project's internal,
gitignored dev notes instead - not committed, since they're working thoughts, not a spec.)

## 1. One tool, one file, one domain folder

Each tool lives in its own file under `src/tools/<domain>/`, e.g. `src/tools/testRuns/someTool.ts`.
Use an existing domain folder if the tool belongs to that area (projects, folders, testCases,
jira, testRuns, environments, users, attachments, hyperexecute, insights). Create a new domain
folder only when the tool represents a genuinely new API surface (a new host, a new product area)
- not for every new tool.

## 2. Naming convention

Tool names follow `tm.verb_noun`:

- `tm.get_X` - read-only lookup/list.
- `tm.create_X` - creates a new resource.
- `tm.update_X` - updates an existing resource.
- `tm.trigger_X` / `tm.generate_X` - dispatches a real action (execution, AI generation, etc.).

If a name turns out confusing once real usage clarifies the domain, rename it rather than keep a
confusing name - this project has no external consumers to preserve backward compatibility for.

## 3. The registration pattern

Every tool file exports one `registerXTool(server, client)` function:

```ts
export function registerGetSomethingTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.get_something",
    { title: "...", description: "...", inputSchema },
    async (input) => {
      try {
        // call client, unwrap response, check one identifying field for success
        return { content: [{ type: "text", text: formatSomething(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, ...) }] };
      }
    },
  );
}
```

Import and invoke it from `src/tools/index.ts`, grouped under its domain with a blank line
separating domains.

## 4. Input schema

- Use Zod. Mark fields required or `.optional()` explicitly; use `z.enum(...)` when the API
  documents a fixed set of values.
- Encode known API constraints client-side where cheap to do so (e.g. an array capped at 100
  items, two fields that must be provided together, two fields that are mutually exclusive) -
  fail fast with a clear message rather than relying solely on the API's own validation error.
- Don't expose a field the API silently ignores - if live testing shows a documented field has no
  effect, drop it from the schema rather than keeping dead input.

## 5. Never hardcode a path - use `endpoints.ts`

Every API path is centralized in `src/config/endpoints.ts`, grouped by domain. A tool calls
`endpoints.<domain>.<name>(...)`, never a literal path string. Endpoints on a different host than
this project's default are stored as full absolute URLs (axios follows them as-is) with a comment
explaining why. Document real, confirmed quirks (spec-vs-actual divergences, undocumented fields,
error-shape peculiarities) as comments directly on the endpoint entry - future tools touching the
same endpoint should not have to rediscover them.

## 6. Call the API only through `client`

Use the injected `client` (`get`/`post`/`patch`/`delete`/`postForm`). Never import or call axios
directly in a tool file.

## 7. Parse responses defensively

Responses are not strictly schema-validated - real API responses often diverge from published
docs. Use the helpers in `src/utils/response.ts` (`readString`, `readNumber`, `readStringArray`,
`unwrapData`, `unwrapDataArray`, `readTagNames`, `formatPaginationFooter`) and read only the
fields a tool actually needs, each falling back gracefully (`?? "N/A"`, empty array, etc.) rather
than throwing on an unexpected shape. Decide success/failure by checking for one identifying field
on the result, not by validating the whole response shape.

## 8. Output is always human-readable text

Every tool returns `content: [{ type: "text", text }]` - never raw JSON. Format lists as numbered
blocks; use a short header/summary line before per-item detail; only include a pagination footer
when there's more than one page.

## 9. Never throw - return `isError: true`

A tool's handler must not let an exception escape. Wrap the body in try/catch; on failure, return
`{ isError: true, content: [{ type: "text", text: describeError(error, ...) }] }`. Each tool file
ends with its own `describeError` function that special-cases known status codes/messages (e.g. a
404 that means something specific for that endpoint) and falls back to a generic message for
anything else.

## 10. Tool `description` text: facts only

A tool's `title`/`description` must state only what a caller needs to know to use it correctly:
purpose, inputs, and quirks/dangers. It must NOT contain:

- Discovery narrative ("confirmed live...", "the user found...", "this was tested against...").
- Real account-specific data - example IDs, usernames, org/project names. Use an invented
  placeholder (e.g. `"PROJ-123"`) if an example is genuinely needed.
- Design rationale or history ("added because...", "replaces the old endpoint which...").

If a piece of information is useful context but fails the above, it belongs in the project's
internal dev notes, not in code.

## 11. Mutating and costly actions need explicit warnings

If a tool creates, updates, deletes, or triggers something real and persistent, its description
must say so plainly. If it's also irreversible or spends real resources (API credits, cloud
infrastructure, sent notifications, etc.), add an explicit **DANGER** line stating the
consequence, and state that it should not be called speculatively. When actually testing such a
tool during development, confirm scope with the user first, and prefer a dry run (stub the
client's mutating method to intercept the request instead of sending it) to verify
request-building and formatting logic before firing a real, resource-consuming call.

## 12. Replace, don't duplicate

If a newly-found endpoint returns the same underlying capability as an existing tool but through a
better interface (cleaner response shape, batching, clearer errors), replace that tool's
implementation rather than adding a parallel one. If it's a genuinely different capability (a
different scope, a different addressing scheme, materially different content) it can be its own
tool, even if related to an existing one - and a fast/reliable path should stay a separate,
explicit tool from a slower or less reliable fallback path, rather than silently combined into one
tool that might hang or behave unpredictably depending on which path it takes.

## 13. Before considering a new tool done

- `npm run build` must pass with no errors.
- Read-only tools: verify against real data, including at least one not-found/empty case.
- Mutating tools: verify the request/response shape via a dry run, then - with the scope
  confirmed by the user - verify at least once for real, including the tool's own error paths for
  invalid input (which are normally free to test, unlike the happy path).
