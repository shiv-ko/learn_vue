import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

vi.mock("../../src/line-webhook/verify-signature", () => ({
  verifySignature: vi.fn(),
}));
vi.mock("../../src/shared/todos-repository", () => ({
  createTodo: vi.fn(),
}));
vi.mock("../../src/shared/bookmarks-service", () => ({
  registerBookmarkBatch: vi.fn(),
}));

import { handler } from "../../src/line-webhook/handler";
import { verifySignature } from "../../src/line-webhook/verify-signature";
import * as repo from "../../src/shared/todos-repository";
import * as bookmarkService from "../../src/shared/bookmarks-service";

function eventWithBody(body: string, signature = "sig"): APIGatewayProxyEvent {
  return {
    httpMethod: "POST",
    body,
    headers: { "x-line-signature": signature },
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("line-webhook handler", () => {
  it("returns 401 when the signature is invalid", async () => {
    vi.mocked(verifySignature).mockReturnValue(false);

    const result = await handler(eventWithBody(JSON.stringify({ events: [] })));

    expect(result.statusCode).toBe(401);
    expect(repo.createTodo).not.toHaveBeenCalled();
    expect(bookmarkService.registerBookmarkBatch).not.toHaveBeenCalled();
  });

  it("creates bookmarks for every URL and saves the remaining text as a memo", async () => {
    vi.mocked(verifySignature).mockReturnValue(true);
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          message: {
            type: "text",
            text: "週末に読む\nhttps://example.com/one\nhttps://example.com/two",
          },
        },
      ],
    });

    const result = await handler(eventWithBody(body));

    expect(result.statusCode).toBe(200);
    expect(repo.createTodo).not.toHaveBeenCalled();
    expect(bookmarkService.registerBookmarkBatch).toHaveBeenCalledWith({
      items: [
        { url: "https://example.com/one" },
        { url: "https://example.com/two" },
      ],
      memo: "週末に読む",
      status: "inbox",
      source: "line",
    });
  });

  it("limits one LINE message to twenty bookmarks", async () => {
    vi.mocked(verifySignature).mockReturnValue(true);
    const text = Array.from({ length: 22 }, (_, index) => `https://example.com/${index}`).join("\n");

    await handler(
      eventWithBody(JSON.stringify({
        events: [{ type: "message", message: { type: "text", text } }],
      })),
    );

    const input = vi.mocked(bookmarkService.registerBookmarkBatch).mock.calls[0][0];
    expect(input.items).toHaveLength(20);
  });

  it("creates a todo for each text message event", async () => {
    vi.mocked(verifySignature).mockReturnValue(true);
    const body = JSON.stringify({
      events: [
        { type: "message", message: { type: "text", text: "牛乳を買う" } },
      ],
    });

    const result = await handler(eventWithBody(body));

    expect(result.statusCode).toBe(200);
    expect(repo.createTodo).toHaveBeenCalledWith({
      title: "牛乳を買う",
      tags: ["inbox"],
    });
  });

  it("ignores non-text message events", async () => {
    vi.mocked(verifySignature).mockReturnValue(true);
    const body = JSON.stringify({
      events: [{ type: "message", message: { type: "sticker" } }],
    });

    const result = await handler(eventWithBody(body));

    expect(result.statusCode).toBe(200);
    expect(repo.createTodo).not.toHaveBeenCalled();
  });
});
