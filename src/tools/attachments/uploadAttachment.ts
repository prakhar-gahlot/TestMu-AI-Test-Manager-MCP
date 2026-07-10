import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAxiosError } from "axios";
import { z } from "zod";
import type { LambdaTestClient } from "../../client.js";
import { endpoints } from "../../config/endpoints.js";
import { readString } from "../../utils/response.js";

// Uploads a LOCAL file (from the machine running this MCP server, not a
// remote URL) to Test Manager's attachment storage. Returns both a presigned
// S3 `url` (time-limited - the sample response's own query string carries a
// 900-second expiry) and a durable `file_key`. Confirmed live: it's the
// file_key that other endpoints (e.g. tm.update_testCaseInstanceStep's
// attachment_urls) actually expect, not the URL - the URL is only useful for
// immediately previewing/verifying the upload itself.
const inputSchema = {
  file_path: z.string().trim().min(1, "file_path is required"),
};

export function registerUploadAttachmentTool(server: McpServer, client: LambdaTestClient): void {
  server.registerTool(
    "tm.upload_attachment",
    {
      title: "Upload a Test Manager Attachment",
      description:
        "Uploads a local file (given by its path on this machine) to Test Manager's attachment " +
        "storage. Returns the uploaded file's file_key, file name, and a presigned URL. Use the " +
        "file_key (not the URL) with tools that accept attachment_urls, e.g. " +
        "tm.update_testCaseInstanceStep - despite that field's name, it expects file_key values. The " +
        "returned URL is only useful for immediately previewing the upload; it's time-limited, not a " +
        "permanent link. Do not call this speculatively - it performs a real upload.",
      inputSchema,
    },
    async ({ file_path }) => {
      let fileBuffer: Buffer;
      try {
        fileBuffer = await readFile(file_path);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not read local file "${file_path}": ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            },
          ],
        };
      }

      const fileName = basename(file_path);
      const form = new FormData();
      form.append("file", new Blob([fileBuffer]), fileName);

      try {
        const response = await client.postForm(endpoints.attachments.upload, form);
        const result = response as Record<string, unknown>;

        const url = readString(result?.url);
        const fileKey = readString(result?.file_key);
        if (readString(result?.type) !== "Success" || !url || !fileKey) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Could not upload "${file_path}": ${readString(result?.message) ?? "unexpected response from the API."}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: [
                `File "${readString(result.file_name) ?? fileName}" uploaded successfully.`,
                `File Key: ${fileKey}`,
                `URL (time-limited): ${url}`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: describeError(error, file_path) }] };
      }
    },
  );
}

// Turns any failure - a non-2xx API response or a network error - into a
// single, useful message for the caller.
function describeError(error: unknown, filePath: string): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const rawBody = error.response?.data;
    const apiMessage =
      typeof rawBody === "string"
        ? rawBody
        : (rawBody as { message?: unknown } | undefined)?.message
          ? String((rawBody as { message?: unknown }).message)
          : undefined;

    return `LambdaTest API error${status ? ` (${status})` : ""}: ${apiMessage ?? error.message}`;
  }

  return `Failed to upload "${filePath}": ${error instanceof Error ? error.message : "Unknown error"}`;
}
