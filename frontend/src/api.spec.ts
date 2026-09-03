import { afterEach, describe, expect, it, vi } from "vitest";
import { bookmarkApi, todoApi } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("todoApi", () => {
  it("sends the Cognito ID token without exposing an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await todoApi.list("id-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "/todos",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "id-token" }) }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("x-api-key");
  });

  it("turns an unauthorized response into a typed error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(todoApi.list("expired-token")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Unauthorized",
    });
  });

  it("sends parentId when creating a child todo", async () => {
    const child = {
      id: "child-1",
      title: "Cognitoを調べる",
      done: false,
      parentId: "parent-1",
      position: 0,
      createdAt: "now",
      updatedAt: "now",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(child), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await todoApi.create("id-token", {
      title: child.title,
      parentId: child.parentId,
      position: child.position,
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      title: child.title,
      parentId: "parent-1",
      position: 0,
    });
  });
});

describe("bookmarkApi", () => {
  it("uses the protected bookmark resource", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await bookmarkApi.list("id-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "/bookmarks",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "id-token" }) }),
    );
  });

  it("updates a bookmark by encoded ID", async () => {
    const bookmark = {
      id: "a/b",
      url: "https://example.com/",
      normalizedUrl: "https://example.com/",
      status: "inbox",
      tags: [],
      favorite: false,
      source: "line",
      metadataStatus: "pending",
      createdAt: "now",
      updatedAt: "now",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(bookmark), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await bookmarkApi.update("id-token", bookmark.id, { favorite: true });

    expect(fetchMock.mock.calls[0][0]).toBe("/bookmarks/a%2Fb");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ favorite: true });
  });

  it("reports an understandable error when the dev server returns index.html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(bookmarkApi.list("id-token")).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: "APIからJSONではない応答が返されました。接続先の設定を確認してください。",
    });
  });
});
