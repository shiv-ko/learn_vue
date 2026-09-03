import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { bookmarkId, normalizeBookmarkUrl } from "./bookmark-url";
import type {
  Bookmark,
  RegisterBookmarkInput,
  UpdateBookmarkInput,
} from "./types";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export class BookmarkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookmarkConflictError";
  }
}

function tableName(): string {
  const name = process.env.BOOKMARKS_TABLE_NAME;
  if (!name) throw new Error("BOOKMARKS_TABLE_NAME is not set");
  return name;
}

export async function registerBookmark(
  input: RegisterBookmarkInput,
): Promise<{ bookmark: Bookmark; created: boolean }> {
  const normalizedUrl = normalizeBookmarkUrl(input.url);
  if (!normalizedUrl) throw new TypeError("invalid bookmark URL");

  const now = new Date().toISOString();
  const id = bookmarkId(normalizedUrl);
  const bookmark: Bookmark = {
    id,
    url: input.url.trim(),
    normalizedUrl,
    status: input.status ?? "inbox",
    tags: input.tags ?? [],
    memo: input.memo,
    favorite: false,
    source: input.source,
    metadataStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await client.send(
      new PutCommand({
        TableName: tableName(),
        Item: bookmark,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
    return { bookmark, created: true };
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
  }

  const existing = await getBookmark(id);
  if (!existing) return registerBookmark(input);

  const tags = mergeTags(existing.tags, input.tags ?? []);
  const updated: Bookmark = {
    ...existing,
    tags,
    ...(input.memo !== undefined ? { memo: input.memo } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: now,
  };
  await putBookmark(updated);
  return { bookmark: updated, created: false };
}

export async function listBookmarks(): Promise<Bookmark[]> {
  const result = await client.send(
    new ScanCommand({ TableName: tableName(), ConsistentRead: true }),
  );
  return (result.Items ?? []) as Bookmark[];
}

export async function getBookmark(id: string): Promise<Bookmark | undefined> {
  const result = await client.send(
    new GetCommand({ TableName: tableName(), Key: { id } }),
  );
  return result.Item as Bookmark | undefined;
}

export async function updateBookmark(
  id: string,
  input: UpdateBookmarkInput,
): Promise<Bookmark | undefined> {
  const existing = await getBookmark(id);
  if (!existing) return undefined;

  const now = new Date().toISOString();
  let updated: Bookmark = { ...existing, updatedAt: now };

  if (input.title !== undefined) {
    if (input.title === null) delete updated.title;
    else updated.title = input.title;
  }
  if (input.memo !== undefined) {
    if (input.memo === null) delete updated.memo;
    else updated.memo = input.memo;
  }
  if (input.status !== undefined) updated.status = input.status;
  if (input.tags !== undefined) updated.tags = input.tags;
  if (input.favorite !== undefined) updated.favorite = input.favorite;

  if (input.url === undefined) {
    await putBookmark(updated);
    return updated;
  }

  const normalizedUrl = normalizeBookmarkUrl(input.url);
  if (!normalizedUrl) throw new TypeError("invalid bookmark URL");
  const nextId = bookmarkId(normalizedUrl);
  updated = {
    ...updated,
    id: nextId,
    url: input.url.trim(),
    normalizedUrl,
    metadataStatus: "pending",
  };
  delete updated.description;
  delete updated.siteName;
  delete updated.imageUrl;
  if (input.title === undefined) delete updated.title;

  if (nextId === id) {
    await putBookmark(updated);
    return updated;
  }

  try {
    await client.send(
      new PutCommand({
        TableName: tableName(),
        Item: updated,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  } catch (error) {
    if (isConditionalFailure(error)) {
      throw new BookmarkConflictError("bookmark URL already exists");
    }
    throw error;
  }
  await client.send(new DeleteCommand({ TableName: tableName(), Key: { id } }));
  return updated;
}

export async function updateBookmarkMetadata(
  id: string,
  metadata:
    | { status: "failed" }
    | {
        status: "ready";
        title: string;
        description?: string;
        siteName: string;
        imageUrl?: string;
      },
): Promise<Bookmark | undefined> {
  const existing = await getBookmark(id);
  if (!existing) return undefined;

  const updated: Bookmark = {
    ...existing,
    metadataStatus: metadata.status,
    updatedAt: new Date().toISOString(),
  };
  if (metadata.status === "ready") {
    updated.title = metadata.title;
    updated.siteName = metadata.siteName;
    if (metadata.description) updated.description = metadata.description;
    else delete updated.description;
    if (metadata.imageUrl) updated.imageUrl = metadata.imageUrl;
    else delete updated.imageUrl;
  }
  await putBookmark(updated);
  return updated;
}

export async function deleteBookmark(id: string): Promise<boolean> {
  const existing = await getBookmark(id);
  if (!existing) return false;
  await client.send(new DeleteCommand({ TableName: tableName(), Key: { id } }));
  return true;
}

async function putBookmark(bookmark: Bookmark): Promise<void> {
  await client.send(new PutCommand({ TableName: tableName(), Item: bookmark }));
}

function mergeTags(current: string[], incoming: string[]): string[] {
  return [...new Map([...current, ...incoming].map((tag) => [tag.toLocaleLowerCase(), tag])).values()];
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}
