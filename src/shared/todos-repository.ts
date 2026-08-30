import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CreateTodoInput, Todo, UpdateTodoInput } from "./types";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export class TodoRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoRuleError";
  }
}

function tableName(): string {
  const name = process.env.TODOS_TABLE_NAME;
  if (!name) throw new Error("TODOS_TABLE_NAME is not set");
  return name;
}

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  const now = new Date().toISOString();
  let position = input.position;
  if (input.parentId) {
    const parent = await getTodo(input.parentId);
    assertCanContainChildren(parent);
    if (input.kind === "stacked") {
      throw new TodoRuleError("a child todo cannot be stacked");
    }
    if (position === undefined) {
      position = (await listChildren(input.parentId)).length;
    }
  }
  const todo: Todo = {
    id: randomUUID(),
    title: input.title,
    done: false,
    dueDate: input.dueDate,
    priority: input.priority,
    memo: input.memo,
    note: input.note,
    tags: input.tags,
    kind: input.parentId ? "standard" : (input.kind ?? "standard"),
    parentId: input.parentId,
    position: input.parentId ? position : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await client.send(new PutCommand({ TableName: tableName(), Item: todo }));
  if (todo.parentId) {
    await normalizeChildPositions(todo.parentId, todo.id, todo.position);
    await syncParentCompletion(todo.parentId);
  }
  return todo;
}

export async function listTodos(): Promise<Todo[]> {
  const result = await client.send(
    new ScanCommand({ TableName: tableName(), ConsistentRead: true }),
  );
  return (result.Items ?? []) as Todo[];
}

export async function getTodo(id: string): Promise<Todo | undefined> {
  const result = await client.send(
    new GetCommand({ TableName: tableName(), Key: { id } }),
  );
  return result.Item as Todo | undefined;
}

export async function updateTodo(
  id: string,
  input: UpdateTodoInput,
): Promise<Todo | undefined> {
  const existing = await getTodo(id);
  if (!existing) return undefined;

  if (existing.parentId && input.kind === "stacked") {
    throw new TodoRuleError("a child todo cannot be stacked");
  }
  if (
    !existing.parentId &&
    (existing.kind ?? "standard") === "stacked" &&
    input.done !== undefined &&
    (await listChildren(existing.id)).length > 0
  ) {
    throw new TodoRuleError("stacked todo completion is determined by its children");
  }
  if (input.parentId === id) {
    throw new TodoRuleError("a todo cannot be its own parent");
  }

  const previousParentId = existing.parentId;
  const nextParentId =
    input.parentId === undefined
      ? existing.parentId
      : input.parentId === null
        ? undefined
        : input.parentId;

  if (nextParentId) {
    if ((existing.kind ?? "standard") === "stacked") {
      throw new TodoRuleError("a stacked todo cannot be a child");
    }
    const parent = await getTodo(nextParentId);
    assertCanContainChildren(parent);
  }

  const { priority, parentId: _parentId, position, ...fields } = input;
  const updated: Todo = {
    ...existing,
    ...fields,
    ...(priority && { priority }),
    ...(nextParentId ? { parentId: nextParentId, position: position ?? existing.position ?? 0 } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (priority === null) delete updated.priority;
  if (!nextParentId) {
    delete updated.parentId;
    delete updated.position;
  }

  if (input.kind === "standard" && (existing.kind ?? "standard") === "stacked") {
    const children = await listChildren(existing.id);
    await Promise.all(
      children.map((child) => {
        const detached = { ...child, updatedAt: updated.updatedAt };
        delete detached.parentId;
        delete detached.position;
        return putTodo(detached);
      }),
    );
  }

  await client.send(new PutCommand({ TableName: tableName(), Item: updated }));

  if (previousParentId && previousParentId !== nextParentId) {
    await normalizeChildPositions(previousParentId);
    await syncParentCompletion(previousParentId);
  }
  if (nextParentId) {
    if (previousParentId !== nextParentId || position !== undefined) {
      await normalizeChildPositions(nextParentId, updated.id, position ?? updated.position);
    }
    await syncParentCompletion(nextParentId);
  }
  return updated;
}

export async function deleteTodo(id: string): Promise<boolean> {
  const existing = await getTodo(id);
  if (!existing) return false;

  if ((existing.kind ?? "standard") === "stacked") {
    const children = await listChildren(existing.id);
    await Promise.all(
      children.map((child) => {
        const detached = { ...child, updatedAt: new Date().toISOString() };
        delete detached.parentId;
        delete detached.position;
        return putTodo(detached);
      }),
    );
  }

  await client.send(
    new DeleteCommand({ TableName: tableName(), Key: { id } }),
  );
  if (existing.parentId) {
    await normalizeChildPositions(existing.parentId);
    await syncParentCompletion(existing.parentId);
  }
  return true;
}

async function listChildren(parentId: string): Promise<Todo[]> {
  const todos = await listTodos();
  return todos
    .filter((todo) => todo.parentId === parentId)
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

async function normalizeChildPositions(
  parentId: string,
  movedId?: string,
  requestedPosition?: number,
): Promise<void> {
  const children = await listChildren(parentId);
  if (movedId) {
    const movedIndex = children.findIndex((child) => child.id === movedId);
    if (movedIndex >= 0) {
      const [moved] = children.splice(movedIndex, 1);
      const target = Math.max(
        0,
        Math.min(Math.trunc(requestedPosition ?? children.length), children.length),
      );
      children.splice(target, 0, moved);
    }
  }

  await Promise.all(
    children.map((child, index) =>
      child.position === index ? Promise.resolve() : putTodo({ ...child, position: index }),
    ),
  );
}

async function syncParentCompletion(parentId: string): Promise<void> {
  const [parent, children] = await Promise.all([getTodo(parentId), listChildren(parentId)]);
  if (!parent) return;
  const done = children.length > 0 && children.every((child) => child.done);
  if (parent.done !== done) {
    await putTodo({ ...parent, done, updatedAt: new Date().toISOString() });
  }
}

function assertCanContainChildren(parent: Todo | undefined): asserts parent is Todo {
  if (!parent) throw new TodoRuleError("parent todo not found");
  if (parent.parentId || (parent.kind ?? "standard") !== "stacked") {
    throw new TodoRuleError("parent must be a top-level stacked todo");
  }
}

async function putTodo(todo: Todo): Promise<void> {
  await client.send(new PutCommand({ TableName: tableName(), Item: todo }));
}
