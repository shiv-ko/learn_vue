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
