import { appConfig } from "./config";
import type { Bookmark, CreateTodoInput, Todo, UpdateBookmarkInput, UpdateTodoInput } from "./types";

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
  basePath: string = appConfig.apiBasePath,
): Promise<T> {
  const response = await fetch(`${basePath}${path}`, {
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

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(
      "APIからJSONではない応答が返されました。接続先の設定を確認してください。",
      response.status,
    );
  }

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

export const bookmarkApi = {
  list: (token: string) => request<Bookmark[]>(token, "", {}, "/bookmarks"),
  update: (token: string, id: string, input: UpdateBookmarkInput) =>
    request<Bookmark>(token, `/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }, "/bookmarks"),
  remove: (token: string, id: string) =>
    request<void>(token, `/${encodeURIComponent(id)}`, { method: "DELETE" }, "/bookmarks"),
};
