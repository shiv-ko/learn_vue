import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  createTodo,
  listTodos,
  getTodo,
  updateTodo,
  deleteTodo,
  TodoRuleError,
} from "../../src/shared/todos-repository";

process.env.TODOS_TABLE_NAME = "test-todos-table";

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe("createTodo", () => {
  it("creates a todo with generated id and timestamps", async () => {
    ddbMock.on(PutCommand).resolves({});

    const todo = await createTodo({
      title: "牛乳を買う",
      tags: ["買い物"],
      note: "# 理解したいこと\n価格の違いを調べる",
    });

    expect(todo.title).toBe("牛乳を買う");
    expect(todo.done).toBe(false);
    expect(todo.tags).toEqual(["買い物"]);
    expect(todo.note).toBe("# 理解したいこと\n価格の違いを調べる");
    expect(todo.id).toBeTruthy();
    expect(todo.createdAt).toBeTruthy();
    expect(todo.updatedAt).toBe(todo.createdAt);
  });

  it("places a child after existing siblings", async () => {
    const parent = {
      id: "parent-1",
      title: "パスキーについて学ぶ",
      done: false,
      kind: "stacked" as const,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    ddbMock.on(GetCommand, { Key: { id: "parent-1" } }).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          id: "child-1",
          title: "WebAuthnを理解する",
          done: false,
          parentId: "parent-1",
          position: 0,
          createdAt: "2026-08-27T00:01:00.000Z",
          updatedAt: "2026-08-27T00:01:00.000Z",
        },
      ],
    });
    ddbMock.on(PutCommand).resolves({});

    const child = await createTodo({ title: "試作を動かす", parentId: "parent-1" });

    expect(child.parentId).toBe("parent-1");
    expect(child.position).toBe(1);
    expect(child.kind).toBe("standard");
  });

  it("rejects a second nesting level", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        id: "child-1",
        title: "子Todo",
        done: false,
        parentId: "parent-1",
        createdAt: "now",
        updatedAt: "now",
      },
    });

    await expect(createTodo({ title: "孫Todo", parentId: "child-1" })).rejects.toBeInstanceOf(
      TodoRuleError,
    );
  });
});

describe("listTodos", () => {
  it("returns items from the table", async () => {
    const item = {
      id: "1",
      title: "テスト",
      done: false,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    ddbMock.on(ScanCommand).resolves({ Items: [item] });

    const todos = await listTodos();

    expect(todos).toEqual([item]);
  });

  it("returns an empty array when the table has no items", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: undefined });

    const todos = await listTodos();

    expect(todos).toEqual([]);
  });
});

describe("getTodo", () => {
  it("returns the item when found", async () => {
    const item = {
      id: "1",
      title: "テスト",
      done: false,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    ddbMock.on(GetCommand).resolves({ Item: item });

    const todo = await getTodo("1");

    expect(todo).toEqual(item);
  });

  it("returns undefined when not found", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const todo = await getTodo("missing");

    expect(todo).toBeUndefined();
  });
});

describe("updateTodo", () => {
  it("merges the update into the existing item and bumps updatedAt", async () => {
    const existing = {
      id: "1",
      title: "テスト",
      done: false,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await updateTodo("1", { done: true });

    expect(updated?.done).toBe(true);
    expect(updated?.title).toBe("テスト");
    expect(updated?.updatedAt).not.toBe(existing.updatedAt);
  });

  it("returns undefined when the todo does not exist", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const updated = await updateTodo("missing", { done: true });

    expect(updated).toBeUndefined();
  });

  it("removes priority when the update explicitly clears it", async () => {
    const existing = {
      id: "1",
      title: "テスト",
      done: false,
      priority: "high" as const,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    ddbMock.on(GetCommand).resolves({ Item: existing });
    ddbMock.on(PutCommand).resolves({});

    const updated = await updateTodo("1", { priority: null });
    const putItem = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;

    expect(updated).not.toHaveProperty("priority");
    expect(putItem).not.toHaveProperty("priority");
  });

  it("automatically completes a parent after its last child is done", async () => {
    const child = {
      id: "child-1",
      title: "試作を動かす",
      done: false,
      parentId: "parent-1",
      position: 0,
      createdAt: "2026-08-27T00:01:00.000Z",
      updatedAt: "2026-08-27T00:01:00.000Z",
    };
    const parent = {
      id: "parent-1",
      title: "パスキーについて学ぶ",
      done: false,
      kind: "stacked" as const,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    ddbMock.on(GetCommand, { Key: { id: "child-1" } }).resolves({ Item: child });
    ddbMock.on(GetCommand, { Key: { id: "parent-1" } }).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({ Items: [{ ...child, done: true }] });
    ddbMock.on(PutCommand).resolves({});

    await updateTodo("child-1", { done: true });

    const storedItems = ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item);
    expect(storedItems).toContainEqual(expect.objectContaining({ id: "parent-1", done: true }));
  });

  it("attaches a standard todo to a stacked todo", async () => {
    const standard = {
      id: "todo-1",
      title: "WebAuthnを理解する",
      done: false,
      kind: "standard" as const,
      createdAt: "now",
      updatedAt: "now",
    };
    const parent = {
      id: "parent-1",
      title: "パスキーについて学ぶ",
      done: false,
      kind: "stacked" as const,
      createdAt: "now",
      updatedAt: "now",
    };
    ddbMock.on(GetCommand, { Key: { id: "todo-1" } }).resolves({ Item: standard });
    ddbMock.on(GetCommand, { Key: { id: "parent-1" } }).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const updated = await updateTodo("todo-1", { parentId: "parent-1", position: 0 });

    expect(updated).toMatchObject({ parentId: "parent-1", position: 0 });
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toMatchObject({
      id: "todo-1",
      parentId: "parent-1",
      position: 0,
    });
  });

  it("detaches a child back to a standard todo", async () => {
    const child = {
      id: "child-1",
      title: "WebAuthnを理解する",
      done: false,
      kind: "standard" as const,
      parentId: "parent-1",
      position: 0,
      createdAt: "now",
      updatedAt: "now",
    };
    const parent = {
      id: "parent-1",
      title: "パスキーについて学ぶ",
      done: false,
      kind: "stacked" as const,
      createdAt: "now",
      updatedAt: "now",
    };
    ddbMock.on(GetCommand, { Key: { id: "child-1" } }).resolves({ Item: child });
    ddbMock.on(GetCommand, { Key: { id: "parent-1" } }).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    const updated = await updateTodo("child-1", { parentId: null });

    expect(updated).not.toHaveProperty("parentId");
    expect(updated).not.toHaveProperty("position");
  });

  it("detaches children when converting stacked todo to standard", async () => {
    const parent = {
      id: "parent-1",
      title: "学習計画",
      done: false,
      kind: "stacked" as const,
      createdAt: "now",
      updatedAt: "now",
    };
    const child = {
      id: "child-1",
      title: "資料を読む",
      done: false,
      parentId: "parent-1",
      position: 0,
      createdAt: "now",
      updatedAt: "now",
    };
    ddbMock.on(GetCommand).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({ Items: [child] });
    ddbMock.on(PutCommand).resolves({});

    await updateTodo("parent-1", { kind: "standard" });

    const detached = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(detached).not.toHaveProperty("parentId");
    expect(detached).not.toHaveProperty("position");
  });

  it("rejects direct completion when a stacked todo has children", async () => {
    const parent = {
      id: "parent-1",
      title: "学習計画",
      done: false,
      kind: "stacked" as const,
      createdAt: "now",
      updatedAt: "now",
    };
    ddbMock.on(GetCommand).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          id: "child-1",
          title: "資料を読む",
          done: false,
          parentId: "parent-1",
          createdAt: "now",
          updatedAt: "now",
        },
      ],
    });

    await expect(updateTodo("parent-1", { done: true })).rejects.toBeInstanceOf(
      TodoRuleError,
    );
  });
});

describe("deleteTodo", () => {
  it("returns true and deletes when the todo exists", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        id: "1",
        title: "テスト",
        done: false,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
    });
    ddbMock.on(DeleteCommand).resolves({});

    const result = await deleteTodo("1");

    expect(result).toBe(true);
  });

  it("returns false when the todo does not exist", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await deleteTodo("missing");

    expect(result).toBe(false);
  });

  it("reopens a parent when its last child is removed", async () => {
    const child = {
      id: "child-1",
      title: "試作する",
      done: true,
      parentId: "parent-1",
      position: 0,
      createdAt: "now",
      updatedAt: "now",
    };
    const parent = {
      id: "parent-1",
      title: "学習計画",
      done: true,
      kind: "stacked" as const,
      createdAt: "now",
      updatedAt: "now",
    };
    ddbMock.on(GetCommand, { Key: { id: "child-1" } }).resolves({ Item: child });
    ddbMock.on(GetCommand, { Key: { id: "parent-1" } }).resolves({ Item: parent });
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(DeleteCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    await deleteTodo("child-1");

    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toEqual(
      expect.objectContaining({ id: "parent-1", done: false }),
    );
  });
});
