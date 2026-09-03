import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BookmarkConflictError,
  registerBookmark,
  updateBookmark,
  updateBookmarkMetadata,
} from "../../src/shared/bookmarks-repository";
import { bookmarkId, normalizeBookmarkUrl } from "../../src/shared/bookmark-url";

process.env.BOOKMARKS_TABLE_NAME = "test-bookmarks-table";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddbMock.reset());

describe("registerBookmark", () => {
  it("creates a pending bookmark whose ID is the normalized URL hash", async () => {
    ddbMock.on(PutCommand).resolves({});

    const result = await registerBookmark({
      url: "HTTPS://Example.COM:443/article?q=1#part",
      tags: ["技術"],
      source: "line",
    });

    const normalized = "https://example.com/article?q=1";
    expect(result.created).toBe(true);
    expect(result.bookmark).toMatchObject({
      id: bookmarkId(normalized),
      normalizedUrl: normalized,
      status: "inbox",
      tags: ["技術"],
      favorite: false,
      source: "line",
      metadataStatus: "pending",
    });
  });

  it("merges tags and updates an existing bookmark instead of duplicating it", async () => {
    const url = "https://example.com/article";
    const existing = {
      id: bookmarkId(normalizeBookmarkUrl(url)!),
      url,
      normalizedUrl: normalizeBookmarkUrl(url)!,
      status: "reading" as const,
      tags: ["技術"],
      favorite: true,
      source: "line" as const,
      metadataStatus: "ready" as const,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const conditionalError = new Error("exists");
    conditionalError.name = "ConditionalCheckFailedException";
    ddbMock.on(PutCommand).rejectsOnce(conditionalError).resolves({});
    ddbMock.on(GetCommand).resolves({ Item: existing });

    const result = await registerBookmark({
      url,
      tags: ["週末", "技術"],
      source: "android",
    });

    expect(result.created).toBe(false);
    expect(result.bookmark.tags).toEqual(["技術", "週末"]);
    expect(result.bookmark.status).toBe("reading");
    expect(result.bookmark.source).toBe("line");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(2);
  });
});

describe("updateBookmark", () => {
  const existing = {
    id: "old-id",
    url: "https://example.com/old",
    normalizedUrl: "https://example.com/old",
    title: "Old title",
    description: "Old description",
    siteName: "Example",
    status: "inbox" as const,
    tags: [],
    favorite: false,
    source: "web" as const,
    metadataStatus: "ready" as const,
    createdAt: "now",
    updatedAt: "now",
  };

  it("moves the item to a new hash and resets metadata when its URL changes", async () => {
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    const updated = await updateBookmark("old-id", { url: "https://example.com/new" });

    expect(updated?.id).toBe(bookmarkId("https://example.com/new"));
    expect(updated?.metadataStatus).toBe("pending");
    expect(updated).not.toHaveProperty("title");
    expect(updated).not.toHaveProperty("description");
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ id: "old-id" });
  });

  it("rejects a URL change when the normalized destination already exists", async () => {
    const conflict = new Error("exists");
    conflict.name = "ConditionalCheckFailedException";
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).rejects(conflict);

    await expect(updateBookmark("old-id", { url: "https://example.com/new" }))
      .rejects.toBeInstanceOf(BookmarkConflictError);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});

describe("updateBookmarkMetadata", () => {
  it("keeps the bookmark and marks metadata failures", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        id: "one",
        url: "https://example.com/",
        normalizedUrl: "https://example.com/",
        status: "inbox",
        tags: [],
        favorite: false,
        source: "line",
        metadataStatus: "pending",
        createdAt: "now",
        updatedAt: "now",
      },
    });
    ddbMock.on(PutCommand).resolves({});

    const updated = await updateBookmarkMetadata("one", { status: "failed" });

    expect(updated?.metadataStatus).toBe("failed");
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toMatchObject({
      id: "one",
      metadataStatus: "failed",
    });
  });
});
