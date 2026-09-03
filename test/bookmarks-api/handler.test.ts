import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

vi.mock("../../src/shared/bookmarks-service", () => ({
  enqueueMetadata: vi.fn(),
  registerBookmarkBatch: vi.fn(),
}));
vi.mock("../../src/shared/bookmarks-repository", () => ({
  BookmarkConflictError: class BookmarkConflictError extends Error {},
  listBookmarks: vi.fn(),
  updateBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
}));

import { handler } from "../../src/bookmarks-api/handler";
import * as repository from "../../src/shared/bookmarks-repository";
import * as service from "../../src/shared/bookmarks-service";

function event(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/bookmarks",
    pathParameters: null,
    headers: {},
    body: null,
    ...overrides,
  } as APIGatewayProxyEvent;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /bookmarks/batch", () => {
  it("normalizes shared fields and returns partial item results", async () => {
    vi.mocked(service.registerBookmarkBatch).mockResolvedValue([
      { url: "https://example.com", status: "created", id: "abc" },
      { url: "bad", status: "invalid" },
    ]);

    const response = await handler(event({
      httpMethod: "POST",
      body: JSON.stringify({
        items: [{ url: "https://example.com" }, { url: "bad" }],
        tags: [" 技術 ", "技術", "週末"],
        memo: "あとで読む",
        status: "reading",
        source: "android",
      }),
    }));

    expect(response.statusCode).toBe(200);
    expect(service.registerBookmarkBatch).toHaveBeenCalledWith({
      items: [{ url: "https://example.com" }, { url: "bad" }],
      tags: ["技術", "週末"],
      memo: "あとで読む",
      status: "reading",
      source: "android",
    });
    expect(JSON.parse(response.body).results).toHaveLength(2);
  });

  it("rejects more than twenty items", async () => {
    const response = await handler(event({
      httpMethod: "POST",
      body: JSON.stringify({ items: Array.from({ length: 21 }, () => ({ url: "https://example.com" })) }),
    }));
    expect(response.statusCode).toBe(400);
    expect(service.registerBookmarkBatch).not.toHaveBeenCalled();
  });
});

describe("bookmark CRUD", () => {
  it("lists bookmarks", async () => {
    vi.mocked(repository.listBookmarks).mockResolvedValue([]);
    const response = await handler(event({}));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([]);
  });

  it("updates editable fields", async () => {
    const updated = {
      id: "abc",
      url: "https://example.com/",
      normalizedUrl: "https://example.com/",
      status: "read" as const,
      tags: ["技術"],
      favorite: true,
      source: "android" as const,
      metadataStatus: "ready" as const,
      createdAt: "now",
      updatedAt: "later",
    };
    vi.mocked(repository.updateBookmark).mockResolvedValue(updated);
    const response = await handler(event({
      httpMethod: "PATCH",
      pathParameters: { id: "abc" },
      body: JSON.stringify({ status: "read", tags: [" 技術 "], favorite: true }),
    }));
    expect(response.statusCode).toBe(200);
    expect(repository.updateBookmark).toHaveBeenCalledWith("abc", {
      status: "read",
      tags: ["技術"],
      favorite: true,
    });
  });

  it("deletes a bookmark", async () => {
    vi.mocked(repository.deleteBookmark).mockResolvedValue(true);
    const response = await handler(event({ httpMethod: "DELETE", pathParameters: { id: "abc" } }));
    expect(response.statusCode).toBe(204);
  });
});
