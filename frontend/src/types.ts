export type Priority = "high" | "medium" | "low";
export type TodoKind = "standard" | "stacked";

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  dueDate?: string;
  priority?: Priority;
  memo?: string;
  note?: string;
  tags?: string[];
  kind?: TodoKind;
  parentId?: string;
  position?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoInput {
  title: string;
  dueDate?: string;
  priority?: Priority;
  memo?: string;
  note?: string;
  tags?: string[];
  kind?: TodoKind;
  parentId?: string;
  position?: number;
}

export interface UpdateTodoInput {
  title?: string;
  done?: boolean;
  dueDate?: string;
  priority?: Priority | null;
  memo?: string;
  note?: string;
  tags?: string[];
  kind?: TodoKind;
  parentId?: string | null;
  position?: number;
}

export type TodoFilter = "open" | "all" | "done";

export type BookmarkStatus = "inbox" | "reading" | "read" | "archive";
export type BookmarkSource = "line" | "android" | "web";
export type MetadataStatus = "pending" | "ready" | "failed";

export interface Bookmark {
  id: string;
  url: string;
  normalizedUrl: string;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  status: BookmarkStatus;
  tags: string[];
  memo?: string;
  favorite: boolean;
  source: BookmarkSource;
  metadataStatus: MetadataStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateBookmarkInput {
  url?: string;
  title?: string | null;
  status?: BookmarkStatus;
  tags?: string[];
  memo?: string | null;
  favorite?: boolean;
}
