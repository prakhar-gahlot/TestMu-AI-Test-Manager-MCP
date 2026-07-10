/**
 * Shared helpers for reading LambdaTest API responses defensively.
 *
 * We deliberately do NOT enforce strict schemas on API responses - different
 * endpoints (and different API versions) may include, omit, or nest fields
 * differently, and a rigid schema would reject a perfectly valid response
 * just because one field looked different. Instead, tools read only the
 * fields they need via these helpers, each falling back to `undefined`
 * rather than throwing, and use the presence of one key identifying field
 * (e.g. `name` on a project, `id` on a created resource) to decide whether
 * the call actually succeeded.
 */
export type UnknownRecord = Record<string, unknown>;

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Some create endpoints (e.g. batch test case creation) return `id` as an
 * array of strings rather than a single string. Non-string entries are
 * dropped rather than failing the whole read.
 */
export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/**
 * Some LambdaTest endpoints wrap their payload in a `data` envelope
 * (`{ data: { ... } }`), others return the payload directly. Unwrapping
 * here means every tool reads fields the same way regardless of which
 * shape a given endpoint happens to use.
 */
export function unwrapData(response: unknown): UnknownRecord {
  const record = response as UnknownRecord | undefined;
  const data = record?.data;
  return (data && typeof data === "object" ? data : record) as UnknownRecord;
}

/**
 * Same idea as `unwrapData`, for endpoints whose payload is a list
 * (`{ data: [...] }` or a bare array). Falls back to an empty array rather
 * than throwing if the shape doesn't match - an empty list is a safe,
 * harmless default for "nothing to show".
 */
export function unwrapDataArray(response: unknown): UnknownRecord[] {
  const record = response as { data?: unknown } | undefined;

  if (Array.isArray(record?.data)) {
    return record.data as UnknownRecord[];
  }

  if (Array.isArray(response)) {
    return response as UnknownRecord[];
  }

  return [];
}

/**
 * Several LambdaTest resources (project tags, test case tags) return tags as
 * `{ tag_id, name }` objects, but callers only ever display the name. Reading
 * them loosely - rather than via a strict schema - means a tag missing
 * `tag_id`, or a future API version sending plain strings, still renders.
 */
export function readTagNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((tag) => {
    if (tag && typeof tag === "object" && "name" in tag) {
      return String((tag as UnknownRecord).name);
    }
    return String(tag);
  });
}

/**
 * Test case / test step `attachments` arrays come back as full objects
 * ({ file_key, file_name, url }), but the PUT endpoints that accept them back
 * only want the bare file_key strings (confirmed live - passing full objects
 * is rejected with a 400 "give correct input value" error). This extracts
 * just the file_keys, so a caller who doesn't touch attachments can carry
 * the current set forward without also needing to strip the other fields.
 */
export function readAttachmentFileKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attachment) => readString((attachment as UnknownRecord | undefined)?.file_key))
    .filter((fileKey): fileKey is string => fileKey !== undefined);
}

/**
 * Summarizes the `pagination` block that list endpoints (folders, test
 * cases, ...) return alongside `data`. Returns `undefined` if the block is
 * missing or malformed, so callers can simply omit the footer rather than
 * showing a broken one.
 */
export function formatPaginationFooter(response: unknown, itemLabel: string): string | undefined {
  const pagination = (response as UnknownRecord | undefined)?.pagination as UnknownRecord | undefined;
  const total = readNumber(pagination?.total);
  const currentPage = readNumber(pagination?.current_page);
  const lastPage = readNumber(pagination?.last_page);

  if (total === undefined || currentPage === undefined || lastPage === undefined) {
    return undefined;
  }

  return `Showing page ${currentPage} of ${lastPage} (${total} total ${itemLabel}${total === 1 ? "" : "s"}).`;
}
