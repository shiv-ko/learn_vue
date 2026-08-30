import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

vi.mock("../../src/line-webhook/verify-signature", () => ({
  verifySignature: vi.fn(),
}));
vi.mock("../../src/shared/todos-repository", () => ({
  createTodo: vi.fn(),
}));

import { handler } from "../../src/line-webhook/handler";
import { verifySignature } from "../../src/line-webhook/verify-signature";
import * as repo from "../../src/shared/todos-repository";

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
