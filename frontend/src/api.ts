import { appConfig } from "./config";
import type { CreateTodoInput, Todo, UpdateTodoInput } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  token: string,
  path = "",
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${appConfig.apiBasePath}${path}`, {
    ...options,
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = "通信に失敗しました。少し待ってからもう一度お試しください。";
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // API Gateway may return an empty or non-JSON response.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const todoApi = {
  list: (token: string) => request<Todo[]>(token),
  create: (token: string, input: CreateTodoInput) =>
    request<Todo>(token, "", { method: "POST", body: JSON.stringify(input) }),
  update: (token: string, id: string, input: UpdateTodoInput) =>
    request<Todo>(token, `/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (token: string, id: string) =>
    request<void>(token, `/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

