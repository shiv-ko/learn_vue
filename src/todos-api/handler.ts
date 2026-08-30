import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  createTodo,
  deleteTodo,
  listTodos,
  updateTodo,
} from "../shared/todos-repository";
import { TodoRuleError } from "../shared/todos-repository";
import type {
  CreateTodoInput,
  Priority,
  UpdateTodoInput,
} from "../shared/types";

const NOTE_MAX_LENGTH = 20_000;

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;
    const id = event.pathParameters?.id;

    if (method === "GET" && !id) {
      const todos = await listTodos();
      return respond(200, todos);
    }

    if (method === "POST" && !id) {
      const body = parseBody(event.body);
      if (!body || typeof body.title !== "string" || body.title.length === 0) {
        return respond(400, { message: "title is required" });
      }
      const input = parseCreateInput(body);
      if (!input) return respond(400, { message: "invalid todo fields" });
      const todo = await createTodo(input);
      return respond(201, todo);
    }

    if (method === "PATCH" && id) {
      const body = parseBody(event.body);
      if (!body) return respond(400, { message: "invalid todo fields" });
      const input = parseUpdateInput(body);
      if (!input) return respond(400, { message: "invalid todo fields" });
      const updated = await updateTodo(id, input);
      if (!updated) return respond(404, { message: "todo not found" });
      return respond(200, updated);
    }

    if (method === "DELETE" && id) {
      const deleted = await deleteTodo(id);
      if (!deleted) return respond(404, { message: "todo not found" });
      return respond(204, undefined);
    }

    return respond(404, { message: "not found" });
  } catch (error) {
    if (error instanceof TodoRuleError) {
      return respond(400, { message: error.message });
    }
    console.error(error);
    return respond(500, { message: "internal server error" });
  }
}

function parseCreateInput(body: Record<string, unknown>): CreateTodoInput | null {
  const title = normalizeRequiredText(body.title, 200);
  const tags = normalizeTags(body.tags);
  if (!title || tags === null || body.priority === null || !hasValidOptionalFields(body)) return null;

  return {
    title,
    ...(typeof body.dueDate === "string" ? { dueDate: body.dueDate } : {}),
    ...(isPriority(body.priority) ? { priority: body.priority } : {}),
    ...(typeof body.memo === "string" ? { memo: body.memo } : {}),
    ...(typeof body.note === "string" ? { note: body.note } : {}),
    ...(tags ? { tags } : {}),
    ...(isTodoKind(body.kind) ? { kind: body.kind } : {}),
    ...(typeof body.parentId === "string" ? { parentId: body.parentId } : {}),
    ...(typeof body.position === "number" ? { position: body.position } : {}),
  };
}

function parseUpdateInput(body: Record<string, unknown>): UpdateTodoInput | null {
  if (!hasValidOptionalFields(body)) return null;
  const tags = normalizeTags(body.tags);
  if (tags === null) return null;

  const input: UpdateTodoInput = {};
  if (body.title !== undefined) {
    const title = normalizeRequiredText(body.title, 200);
    if (!title) return null;
    input.title = title;
  }
  if (typeof body.done === "boolean") input.done = body.done;
  if (typeof body.dueDate === "string") input.dueDate = body.dueDate;
  if (isPriority(body.priority)) input.priority = body.priority;
  if (body.priority === null || body.priority === "") input.priority = null;
  if (typeof body.memo === "string") input.memo = body.memo;
  if (typeof body.note === "string") input.note = body.note;
  if (tags) input.tags = tags;
  if (isTodoKind(body.kind)) input.kind = body.kind;
  if (typeof body.parentId === "string" || body.parentId === null) input.parentId = body.parentId;
  if (typeof body.position === "number") input.position = body.position;
  return input;
}

function hasValidOptionalFields(body: Record<string, unknown>): boolean {
  return (
    (body.done === undefined || typeof body.done === "boolean") &&
    (body.dueDate === undefined || typeof body.dueDate === "string") &&
    (body.priority === undefined || body.priority === null || body.priority === "" || isPriority(body.priority)) &&
    (body.memo === undefined || typeof body.memo === "string") &&
    (body.note === undefined || (typeof body.note === "string" && body.note.length <= NOTE_MAX_LENGTH))
    && (body.kind === undefined || isTodoKind(body.kind))
    && (body.parentId === undefined || body.parentId === null || typeof body.parentId === "string")
    && (body.position === undefined || (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0))
  );
}

function normalizeRequiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function normalizeTags(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) return null;
  const tags = value.map((tag) => (typeof tag === "string" ? tag.trim() : ""));
  if (tags.some((tag) => tag.length === 0 || tag.length > 30)) return null;
  return [...new Map(tags.map((tag) => [tag.toLocaleLowerCase(), tag])).values()];
}

function isPriority(value: unknown): value is Priority {
  return value === "high" || value === "medium" || value === "low";
}

function isTodoKind(value: unknown): value is "standard" | "stacked" {
  return value === "standard" || value === "stacked";
}

function parseBody(body: string | null): Record<string, unknown> | null {
  if (!body) return null;
  try {
    return JSON.parse(body);
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
