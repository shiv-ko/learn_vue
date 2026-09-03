import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { enqueueMetadata, registerBookmarkBatch } from "../shared/bookmarks-service";
import {
  BookmarkConflictError,
  deleteBookmark,
  listBookmarks,
  updateBookmark,
} from "../shared/bookmarks-repository";
import { normalizeBookmarkUrl } from "../shared/bookmark-url";
import type {
  BookmarkSource,
  BookmarkStatus,
  UpdateBookmarkInput,
} from "../shared/types";

const MAX_BATCH_SIZE = 20;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
const MAX_MEMO_LENGTH = 2_000;
const MAX_TITLE_LENGTH = 500;

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;
    const id = event.pathParameters?.id;

    if (method === "GET" && !id) {
      const bookmarks = await listBookmarks();
      bookmarks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return respond(200, bookmarks);
    }

    if (method === "POST" && !id) {
      const body = parseBody(event.body);
      if (!body || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_BATCH_SIZE) {
        return respond(400, { message: "items must contain between 1 and 20 entries" });
      }
      const tags = normalizeTags(body.tags);
      const memo = normalizeOptionalText(body.memo, MAX_MEMO_LENGTH);
      const status = body.status === undefined ? undefined : parseStatus(body.status);
      const source = body.source === undefined ? "android" : parseSource(body.source);
      if (tags === null || memo === null || status === null || source === null) {
        return respond(400, { message: "invalid bookmark fields" });
      }

      const items = body.items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return { url: undefined };
        return { url: (item as Record<string, unknown>).url };
      });
      const results = await registerBookmarkBatch({
        items,
        ...(tags ? { tags } : {}),
        ...(memo !== undefined ? { memo } : {}),
        ...(status ? { status } : {}),
        source,
      });
      return respond(200, { results });
    }

    if (method === "PATCH" && id) {
      const body = parseBody(event.body);
      const input = body ? parseUpdateInput(body) : null;
      if (!input) return respond(400, { message: "invalid bookmark fields" });
      const updated = await updateBookmark(id, input);
      if (!updated) return respond(404, { message: "bookmark not found" });
      if (input.url !== undefined) await enqueueMetadata(updated.id, updated.url);
      return respond(200, updated);
    }

    if (method === "DELETE" && id) {
      const deleted = await deleteBookmark(id);
      if (!deleted) return respond(404, { message: "bookmark not found" });
      return respond(204, undefined);
    }

    return respond(404, { message: "not found" });
  } catch (error) {
    if (error instanceof BookmarkConflictError) {
      return respond(409, { message: error.message });
    }
    console.error(error);
    return respond(500, { message: "internal server error" });
  }
}

function parseUpdateInput(body: Record<string, unknown>): UpdateBookmarkInput | null {
  const allowed = ["url", "title", "status", "tags", "memo", "favorite"];
  if (!allowed.some((field) => body[field] !== undefined)) return null;
  const input: UpdateBookmarkInput = {};

  if (body.url !== undefined) {
    if (typeof body.url !== "string" || !normalizeBookmarkUrl(body.url)) return null;
    input.url = body.url.trim();
  }
  if (body.title !== undefined) {
    if (body.title !== null && (typeof body.title !== "string" || body.title.trim().length > MAX_TITLE_LENGTH)) return null;
    input.title = body.title === null ? null : (body.title as string).trim();
  }
  if (body.memo !== undefined) {
    if (body.memo !== null && (typeof body.memo !== "string" || body.memo.length > MAX_MEMO_LENGTH)) return null;
    input.memo = body.memo as string | null;
  }
  if (body.status !== undefined) {
    const status = parseStatus(body.status);
    if (!status) return null;
    input.status = status;
  }
  if (body.tags !== undefined) {
    const tags = normalizeTags(body.tags);
    if (!tags) return null;
    input.tags = tags;
  }
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== "boolean") return null;
    input.favorite = body.favorite;
  }
  return input;
}

function normalizeTags(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_TAGS) return null;
  const tags = value.map((tag) => (typeof tag === "string" ? tag.trim() : ""));
  if (tags.some((tag) => tag.length === 0 || tag.length > MAX_TAG_LENGTH)) return null;
  return [...new Map(tags.map((tag) => [tag.toLocaleLowerCase(), tag])).values()];
}

function normalizeOptionalText(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value.trim();
}

function parseStatus(value: unknown): BookmarkStatus | null {
  return value === "inbox" || value === "reading" || value === "read" || value === "archive"
    ? value
    : null;
}

function parseSource(value: unknown): BookmarkSource | null {
  return value === "android" || value === "web" ? value : null;
}

function parseBody(body: string | null): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}
