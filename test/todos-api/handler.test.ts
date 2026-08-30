import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

vi.mock("../../src/shared/todos-repository", () => ({
  TodoRuleError: class TodoRuleError extends Error {},
  createTodo: vi.fn(),
  listTodos: vi.fn(),
  updateTodo: vi.fn(),
  deleteTodo: vi.fn(),
}));

import { handler } from "../../src/todos-api/handler";
import * as repo from "../../src/shared/todos-repository";

function baseEvent(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/todos",
    pathParameters: null,
    body: null,
    headers: {},
    ...overrides,
  } as APIGatewayProxyEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /todos", () => {
  it("returns the todo list with 200", async () => {
    vi.mocked(repo.listTodos).mockResolvedValue([]);

    const result = await handler(baseEvent({ httpMethod: "GET" }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual([]);
  });
});

describe("POST /todos", () => {
  it("creates a todo and returns 201", async () => {
    const created = {
      id: "1",
      title: "牛乳を買う",
      done: false,
      createdAt: "now",
      updatedAt: "now",
    };
    vi.mocked(repo.createTodo).mockResolvedValue(created);

    const result = await handler(
      baseEvent({
        httpMethod: "POST",
        body: JSON.stringify({ title: "牛乳を買う", tags: ["買い物", "今週"] }),
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual(created);
    expect(repo.createTodo).toHaveBeenCalledWith({
      title: "牛乳を買う",
      tags: ["買い物", "今週"],
    });
  });

  it("returns 400 when title is missing", async () => {
    const result = await handler(
      baseEvent({ httpMethod: "POST", body: JSON.stringify({}) }),
    );

    expect(result.statusCode).toBe(400);
    expect(repo.createTodo).not.toHaveBeenCalled();
  });

  it("returns 400 when tags are not a string array", async () => {
    const result = await handler(
      baseEvent({
        httpMethod: "POST",
        body: JSON.stringify({ title: "牛乳を買う", tags: "買い物" }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(repo.createTodo).not.toHaveBeenCalled();
  });

  it("does not accept null priority when creating a todo", async () => {
    const result = await handler(
      baseEvent({
        httpMethod: "POST",
        body: JSON.stringify({ title: "牛乳を買う", priority: null }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(repo.createTodo).not.toHaveBeenCalled();
  });

  it("creates a todo with a markdown note", async () => {
    const created = {
      id: "1",
      title: "Cognitoを調べる",
      done: false,
      note: "# 理解したいこと\n認証の流れを順に学びたい",
      createdAt: "now",
      updatedAt: "now",
    };
    vi.mocked(repo.createTodo).mockResolvedValue(created);

    const result = await handler(
      baseEvent({
        httpMethod: "POST",
        body: JSON.stringify({ title: created.title, note: created.note }),
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(repo.createTodo).toHaveBeenCalledWith({
      title: created.title,
      note: created.note,
    });
  });

  it("accepts stacked todo relationship fields", async () => {
    vi.mocked(repo.createTodo).mockResolvedValue({
      id: "child-1",
      title: "登録フローを図にする",
      done: false,
      kind: "standard",
      parentId: "parent-1",
      position: 2,
      createdAt: "now",
      updatedAt: "now",
    });

    const result = await handler(
      baseEvent({
        httpMethod: "POST",
        body: JSON.stringify({
          title: "登録フローを図にする",
          parentId: "parent-1",
          position: 2,
        }),
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(repo.createTodo).toHaveBeenCalledWith({
      title: "登録フローを図にする",
      parentId: "parent-1",
      position: 2,
    });
  });

  it("rejects a note longer than 20000 characters", async () => {
    const result = await handler(
      baseEvent({
        httpMethod: "POST",
        body: JSON.stringify({ title: "調べる", note: "a".repeat(20_001) }),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(repo.createTodo).not.toHaveBeenCalled();
  });
});

describe("PATCH /todos/{id}", () => {
  it("updates a todo and returns 200", async () => {
    const updated = {
      id: "1",
      title: "牛乳を買う",
      done: true,
      createdAt: "now",
      updatedAt: "later",
    };
    vi.mocked(repo.updateTodo).mockResolvedValue(updated);

    const result = await handler(
      baseEvent({
        httpMethod: "PATCH",
        pathParameters: { id: "1" },
        body: JSON.stringify({ done: true }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(updated);
  });

  it("returns 404 when the todo does not exist", async () => {
    vi.mocked(repo.updateTodo).mockResolvedValue(undefined);

    const result = await handler(
      baseEvent({
        httpMethod: "PATCH",
        pathParameters: { id: "missing" },
        body: JSON.stringify({ done: true }),
      }),
    );

    expect(result.statusCode).toBe(404);
  });

  it("updates freely assigned tags", async () => {
    const updated = {
      id: "1",
      title: "牛乳を買う",
      done: false,
      tags: ["買い物", "今週"],
      createdAt: "now",
      updatedAt: "later",
    };
    vi.mocked(repo.updateTodo).mockResolvedValue(updated);

    const result = await handler(
      baseEvent({
        httpMethod: "PATCH",
        pathParameters: { id: "1" },
        body: JSON.stringify({ tags: [" 買い物 ", "今週", "買い物"] }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(repo.updateTodo).toHaveBeenCalledWith("1", {
      tags: ["買い物", "今週"],
    });
  });

  it("clears priority when null is sent", async () => {
    const updated = {
      id: "1",
      title: "牛乳を買う",
      done: false,
      createdAt: "now",
      updatedAt: "later",
    };
    vi.mocked(repo.updateTodo).mockResolvedValue(updated);

    const result = await handler(
      baseEvent({
        httpMethod: "PATCH",
        pathParameters: { id: "1" },
        body: JSON.stringify({ priority: null }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(repo.updateTodo).toHaveBeenCalledWith("1", { priority: null });
  });

  it("updates the markdown note", async () => {
    const note = "# 次に学ぶこと\nトークン検証を理解する";
    vi.mocked(repo.updateTodo).mockResolvedValue({
      id: "1",
      title: "Cognitoを調べる",
      done: false,
      note,
      createdAt: "now",
      updatedAt: "later",
    });

    const result = await handler(
      baseEvent({
        httpMethod: "PATCH",
        pathParameters: { id: "1" },
        body: JSON.stringify({ note }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(repo.updateTodo).toHaveBeenCalledWith("1", { note });
  });

  it("moves a child to another stacked todo", async () => {
    vi.mocked(repo.updateTodo).mockResolvedValue({
      id: "child-1",
      title: "試作を動かす",
      done: false,
      parentId: "parent-2",
      position: 0,
      createdAt: "now",
      updatedAt: "later",
    });

    const result = await handler(
      baseEvent({
        httpMethod: "PATCH",
        pathParameters: { id: "child-1" },
        body: JSON.stringify({ parentId: "parent-2", position: 0 }),
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(repo.updateTodo).toHaveBeenCalledWith("child-1", {
      parentId: "parent-2",
      position: 0,
    });
  });
});

describe("DELETE /todos/{id}", () => {
  it("deletes a todo and returns 204", async () => {
    vi.mocked(repo.deleteTodo).mockResolvedValue(true);

    const result = await handler(
      baseEvent({ httpMethod: "DELETE", pathParameters: { id: "1" } }),
    );

    expect(result.statusCode).toBe(204);
  });

  it("returns 404 when the todo does not exist", async () => {
    vi.mocked(repo.deleteTodo).mockResolvedValue(false);

    const result = await handler(
      baseEvent({ httpMethod: "DELETE", pathParameters: { id: "missing" } }),
    );

    expect(result.statusCode).toBe(404);
  });
});

describe("unmatched route", () => {
  it("returns 404", async () => {
    const result = await handler(baseEvent({ httpMethod: "PUT" }));

    expect(result.statusCode).toBe(404);
  });
});
