<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError, todoApi } from "../api";
import type { CreateTodoInput, Priority, Todo, TodoFilter, UpdateTodoInput } from "../types";
import TodoComposer from "./TodoComposer.vue";
import TodoItem from "./TodoItem.vue";
import StackedTodoItem from "./StackedTodoItem.vue";

const props = defineProps<{ token: string }>();
const emit = defineEmits<{ logout: []; showBookmarks: [] }>();

const todos = ref<Todo[]>([]);
const filter = ref<TodoFilter>("open");
const selectedTag = ref<string | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const saving = ref(false);
const busyIds = ref(new Set<string>());
const errorMessage = ref("");
const lastSyncedAt = ref<Date | null>(null);
const pendingDelete = ref<{ todo: Todo; timer: number } | null>(null);
const pendingCompletion = ref<{ todo: Todo; timer: number } | null>(null);
const dragging = ref<{
  todo: Todo;
  pointerId: number;
  x: number;
  y: number;
  origin: Priority | null;
} | null>(null);
const activeDropPriority = ref<Priority | null | undefined>(undefined);
const activeDropParentId = ref<string | null>(null);
const dragAnnouncement = ref("");
let pollTimer: number | undefined;

const priorityLanes: Array<{
  key: string;
  value: Priority | null;
  label: string;
  hint: string;
}> = [
  { key: "high", value: "high", label: "高", hint: "先に取りかかる" },
  { key: "medium", value: "medium", label: "中", hint: "次に進める" },
  { key: "low", value: "low", label: "小", hint: "余裕があれば" },
  { key: "none", value: null, label: "未設定", hint: "あとで整理する" },
];

const openCount = computed(
  () =>
    todos.value.filter(
      (todo) =>
        !todo.done &&
        (!isStackedTodo(todo) || !todo.parentId && childrenFor(todo.id).length === 0),
    ).length,
);
const stackedParents = computed(() =>
  todos.value.filter((todo) => !todo.parentId && isStackedTodo(todo)),
);
const availableTags = computed(() => {
  const counts = new Map<string, number>();
  for (const todo of todos.value) {
    for (const tag of todo.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB, "ja"));
});
const visibleTodos = computed(() => {
  const knownIds = new Set(todos.value.map((todo) => todo.id));
  const filtered = todos.value.filter((todo) => {
    if (todo.parentId && knownIds.has(todo.parentId)) return false;
    const matchesState =
      filter.value === "open" ? !todo.done : filter.value === "done" ? todo.done : true;
    const matchesTag =
      !selectedTag.value ||
      todo.tags?.includes(selectedTag.value) ||
      childrenFor(todo.id).some((child) => child.tags?.includes(selectedTag.value!));
    return matchesState && matchesTag;
  });
  return filtered.sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt));
});
const groupedTodos = computed(() =>
  priorityLanes.map((lane) => ({
    ...lane,
    todos: visibleTodos.value.filter((todo) => (todo.priority ?? null) === lane.value),
  })),
);

const emptyMessage = computed(() => {
  if (selectedTag.value) return `「${selectedTag.value}」のTodoはありません。`;
  if (filter.value === "done") return "完了したTodoはまだありません。";
  if (filter.value === "all") return "最初のTodoを追加してみましょう。";
  return "今日のTodoはすべて完了です。";
});

async function loadTodos(silent = false) {
  if (silent) refreshing.value = true;
  else loading.value = true;
  errorMessage.value = "";
  try {
    todos.value = await todoApi.list(props.token);
    lastSyncedAt.value = new Date();
  } catch (error) {
    handleError(error);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function createTodo(input: CreateTodoInput) {
  saving.value = true;
  errorMessage.value = "";
  try {
    let created = await todoApi.create(props.token, input);
    const repair: UpdateTodoInput = {};
    if (input.kind && (created.kind ?? "standard") !== input.kind) {
      repair.kind = input.kind;
    }
    if (input.parentId && created.parentId !== input.parentId) {
      repair.parentId = input.parentId;
      repair.position = input.position ?? childrenFor(input.parentId).length;
    }
    if (Object.keys(repair).length > 0) {
      created = await todoApi.update(props.token, created.id, repair);
    }
    todos.value = [created, ...todos.value];
    if (created.parentId) recalculateLocalParent(created.parentId);
  } catch (error) {
    handleError(error);
  } finally {
    saving.value = false;
  }
}

async function updateTodo(todo: Todo, input: UpdateTodoInput) {
  markBusy(todo.id, true);
  errorMessage.value = "";
  try {
    const updated = await todoApi.update(props.token, todo.id, input);
    replaceTodo(updated);
    if (updated.parentId) recalculateLocalParent(updated.parentId);
    if (input.kind || input.parentId !== undefined || input.position !== undefined) {
      await loadTodos(true);
    }
  } catch (error) {
    handleError(error);
  } finally {
    markBusy(todo.id, false);
  }
}

async function toggleTodo(todo: Todo) {
  if (busyIds.value.has(todo.id)) return;

  const previous = todo;
  const completing = !todo.done;
  const optimistic = { ...todo, done: completing };
  replaceTodo(optimistic);
  markBusy(todo.id, true);
  errorMessage.value = "";

  try {
    const updated = await todoApi.update(props.token, todo.id, { done: completing });
    replaceTodo(updated);
    if (updated.parentId) recalculateLocalParent(updated.parentId);
    if (completing) scheduleCompletionUndo(previous);
    else dismissCompletionUndo(todo.id);
  } catch (error) {
    replaceTodo(previous);
    dismissCompletionUndo(todo.id);
    handleError(error);
  } finally {
    markBusy(todo.id, false);
  }
}

async function changePriority(todo: Todo, priority: Priority | null) {
  if ((todo.priority ?? null) === priority || busyIds.value.has(todo.id)) return;

  const handleId = `priority-handle-${todo.id}`;
  const restoreKeyboardFocus = document.activeElement?.id === handleId;
  const previous = todo;
  const optimistic: Todo = { ...todo };
  if (priority) optimistic.priority = priority;
  else delete optimistic.priority;
  replaceTodo(optimistic);
  markBusy(todo.id, true);
  errorMessage.value = "";

  try {
    const updated = await todoApi.update(props.token, todo.id, { priority });
    replaceTodo(updated);
  } catch (error) {
    replaceTodo(previous);
    handleError(error);
  } finally {
    markBusy(todo.id, false);
    if (
      restoreKeyboardFocus &&
      (document.activeElement === document.body || document.activeElement?.id === handleId)
    ) {
      await nextTick();
      document.getElementById(handleId)?.focus({ preventScroll: true });
    }
  }
}

function startPriorityDrag(todo: Todo, event: PointerEvent) {
  if (busyIds.value.has(todo.id) || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  dragging.value = {
    todo,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    origin: todo.priority ?? null,
  };
  activeDropPriority.value = todo.priority ?? null;
  activeDropParentId.value = null;
  dragAnnouncement.value = `${todo.title}を移動中です。優先度レーンまたはStacked Todoへ移動できます。`;
  document.body.classList.add("is-priority-dragging");
  document.addEventListener("pointermove", movePriorityDrag);
  document.addEventListener("pointerup", finishPriorityDrag);
  document.addEventListener("pointercancel", cancelPriorityDrag);
}

function movePriorityDrag(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragging.value.pointerId) return;
  event.preventDefault();
  dragging.value.x = event.clientX;
  dragging.value.y = event.clientY;
  const parentId = stackParentAtPoint(event.clientX, event.clientY);
  activeDropParentId.value = parentId ?? null;
  activeDropPriority.value = parentId ? undefined : priorityAtPoint(event.clientX, event.clientY);
  scrollDuringDrag(event.clientY);
}

function scrollDuringDrag(y: number) {
  const edge = 72;
  const step = 12;
  if (y < edge) window.scrollBy({ top: -step, behavior: "auto" });
  else if (y > window.innerHeight - edge) window.scrollBy({ top: step, behavior: "auto" });
}

function finishPriorityDrag(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== dragging.value.pointerId) return;
  const dragged = dragging.value;
  const parentId =
    stackParentAtPoint(event.clientX, event.clientY) ?? activeDropParentId.value ?? undefined;
  const target = parentId
    ? undefined
    : priorityAtPoint(event.clientX, event.clientY) ?? activeDropPriority.value;
  clearPriorityDrag();

  if (parentId) {
    const parent = todos.value.find((todo) => todo.id === parentId);
    dragAnnouncement.value = `${dragged.todo.title}を${parent?.title ?? "Stacked Todo"}へ移動しました。`;
    void updateTodo(dragged.todo, {
      parentId,
      position: childrenFor(parentId).length,
    });
  } else if (target !== undefined && target !== dragged.origin) {
    const targetLabel = priorityLanes.find((lane) => lane.value === target)?.label ?? "未設定";
    dragAnnouncement.value = `${dragged.todo.title}を優先度${targetLabel}へ移動しました。`;
    void changePriority(dragged.todo, target);
  } else {
    dragAnnouncement.value = `${dragged.todo.title}の移動を終了しました。`;
  }
}

function cancelPriorityDrag(event?: PointerEvent) {
  if (event && dragging.value && event.pointerId !== dragging.value.pointerId) return;
  if (dragging.value) dragAnnouncement.value = `${dragging.value.todo.title}の移動をキャンセルしました。`;
  clearPriorityDrag();
}

function priorityAtPoint(x: number, y: number): Priority | null | undefined {
  const lane = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-priority-lane]");
  const value = lane?.dataset.priorityLane;
  if (value === "none") return null;
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function stackParentAtPoint(x: number, y: number): string | undefined {
  if (!dragging.value || (dragging.value.todo.kind ?? "standard") === "stacked") {
    return undefined;
  }
  const stack = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stack-parent]");
  const parentId = stack?.dataset.stackParent;
  return parentId && parentId !== dragging.value.todo.id ? parentId : undefined;
}

function clearPriorityDrag() {
  dragging.value = null;
  activeDropPriority.value = undefined;
  activeDropParentId.value = null;
  document.body.classList.remove("is-priority-dragging");
  document.removeEventListener("pointermove", movePriorityDrag);
  document.removeEventListener("pointerup", finishPriorityDrag);
  document.removeEventListener("pointercancel", cancelPriorityDrag);
}

function scheduleDelete(todo: Todo) {
  dismissCompletionUndo();
  if (pendingDelete.value) commitDelete(pendingDelete.value.todo);
  todos.value = todos.value.filter((item) => item.id !== todo.id);
  if (todo.parentId) recalculateLocalParent(todo.parentId);
  const timer = window.setTimeout(() => commitDelete(todo), 5000);
  pendingDelete.value = { todo, timer };
}

function scheduleCompletionUndo(todo: Todo) {
  if (pendingDelete.value) void commitDelete(pendingDelete.value.todo);
  dismissCompletionUndo();
  const timer = window.setTimeout(() => dismissCompletionUndo(todo.id), 5000);
  pendingCompletion.value = { todo, timer };
}

function dismissCompletionUndo(id?: string) {
  if (!pendingCompletion.value || (id && pendingCompletion.value.todo.id !== id)) return;
  window.clearTimeout(pendingCompletion.value.timer);
  pendingCompletion.value = null;
}

function undoCompletion() {
  if (!pendingCompletion.value) return;
  const id = pendingCompletion.value.todo.id;
  dismissCompletionUndo(id);
  const completed = todos.value.find((todo) => todo.id === id);
  if (completed) void toggleTodo(completed);
}

function undoDelete() {
  if (!pendingDelete.value) return;
  window.clearTimeout(pendingDelete.value.timer);
  todos.value = [pendingDelete.value.todo, ...todos.value];
  if (pendingDelete.value.todo.parentId) recalculateLocalParent(pendingDelete.value.todo.parentId);
  pendingDelete.value = null;
}

async function commitDelete(todo: Todo) {
  if (pendingDelete.value?.todo.id === todo.id) {
    window.clearTimeout(pendingDelete.value.timer);
    pendingDelete.value = null;
  }
  try {
    await todoApi.remove(props.token, todo.id);
    await loadTodos(true);
  } catch (error) {
    todos.value = [todo, ...todos.value];
    handleError(error);
  }
}

function replaceTodo(updated: Todo) {
  todos.value = todos.value.map((todo) => (todo.id === updated.id ? updated : todo));
}

function childrenFor(parentId: string): Todo[] {
  return todos.value
    .filter((todo) => todo.parentId === parentId)
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

function isStackedTodo(todo: Todo): boolean {
  return (todo.kind ?? "standard") === "stacked" || childrenFor(todo.id).length > 0;
}

function recalculateLocalParent(parentId: string) {
  const children = childrenFor(parentId);
  const parent = todos.value.find((todo) => todo.id === parentId);
  if (parent) {
    replaceTodo({
      ...parent,
      done: children.length > 0 && children.every((child) => child.done),
    });
  }
}

function moveChild(todo: Todo, parentId: string | null) {
  void updateTodo(
    todo,
    parentId
      ? { parentId, position: childrenFor(parentId).length }
      : { parentId: null },
  );
}

function reorderChild(todo: Todo, position: number) {
  void updateTodo(todo, { position });
}

function markBusy(id: string, busy: boolean) {
  const next = new Set(busyIds.value);
  if (busy) next.add(id);
  else next.delete(id);
  busyIds.value = next;
}

function handleError(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    errorMessage.value = "セッションの有効期限が切れました。もう一度ログインしてください。";
    window.setTimeout(() => emit("logout"), 1500);
    return;
  }
  errorMessage.value = error instanceof Error ? error.message : "操作に失敗しました。";
}

onMounted(() => {
  loadTodos();
  pollTimer = window.setInterval(() => loadTodos(true), 60_000);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (pendingDelete.value) window.clearTimeout(pendingDelete.value.timer);
  if (pendingCompletion.value) window.clearTimeout(pendingCompletion.value.timer);
  clearPriorityDrag();
});
</script>

<template>
  <main class="workspace-shell">
    <header class="app-header">
      <a class="wordmark" href="#top" aria-label="Todo ホーム">Todo.</a>
      <nav class="view-switch" aria-label="表示する機能">
        <button type="button" class="view-switch-button is-active" aria-current="page">Todo</button>
        <button type="button" class="view-switch-button" @click="emit('showBookmarks')">あとで読む</button>
      </nav>
      <div class="header-actions">
        <span class="sync-status" aria-live="polite">
          <span class="status-dot" :class="{ 'is-refreshing': refreshing }" aria-hidden="true" />
          {{ refreshing ? "同期中" : lastSyncedAt ? "同期済み" : "接続中" }}
        </span>
        <button class="text-button" type="button" @click="emit('logout')">ログアウト</button>
      </div>
    </header>

    <section id="top" class="workspace">
      <div class="workspace-heading">
        <div>
          <p class="eyebrow">MY WORKBENCH</p>
          <h1>やること</h1>
        </div>
        <p class="remaining-count"><strong>{{ openCount }}</strong><span>件 残っています</span></p>
      </div>

      <TodoComposer :saving="saving" @create="createTodo" />

      <div class="list-toolbar">
        <div class="filter-tabs" role="group" aria-label="Todoの絞り込み">
          <button
            v-for="option in ([['open', '未完了'], ['all', 'すべて'], ['done', '完了']] as const)"
            :key="option[0]"
            class="filter-button"
            :class="{ 'is-active': filter === option[0] }"
            type="button"
            :aria-pressed="filter === option[0]"
            @click="filter = option[0]"
          >
            {{ option[1] }}
          </button>
        </div>
        <button class="icon-button refresh-button" type="button" :disabled="refreshing" aria-label="再読み込み" @click="loadTodos(true)">
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <div v-if="availableTags.length" class="tag-filter" role="group" aria-label="タグで絞り込み">
        <span class="tag-filter-label">タグ</span>
        <button
          class="tag-filter-button"
          :class="{ 'is-active': selectedTag === null }"
          type="button"
          :aria-pressed="selectedTag === null"
          @click="selectedTag = null"
        >
          すべて
        </button>
        <button
          v-for="([tag, count]) in availableTags"
          :key="tag"
          class="tag-filter-button"
          :class="{ 'is-active': selectedTag === tag }"
          type="button"
          :aria-pressed="selectedTag === tag"
          @click="selectedTag = selectedTag === tag ? null : tag"
        >
          {{ tag }} <span aria-hidden="true">{{ count }}</span>
        </button>
      </div>

      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>

      <div v-if="loading" class="list-loading" aria-live="polite">
        <span class="spinner" aria-hidden="true" />
        <span>Todoを読み込んでいます</span>
      </div>
      <ul v-else-if="filter === 'done' && visibleTodos.length" class="todo-list completed-list" aria-label="完了したTodo">
        <template v-for="todo in visibleTodos" :key="todo.id">
          <StackedTodoItem
            v-if="isStackedTodo(todo)"
            :todo="todo"
            :children="childrenFor(todo.id)"
            :parents="stackedParents"
            :busy-ids="busyIds"
            :movable="false"
            :show-priority="true"
            :drop-target="activeDropParentId === todo.id"
            @toggle="toggleTodo"
            @update="updateTodo"
            @remove="scheduleDelete"
            @create-child="createTodo"
            @move-child="moveChild"
            @reorder-child="reorderChild"
          />
          <TodoItem
            v-else
            :todo="todo"
            :busy="busyIds.has(todo.id)"
            :deletable="true"
            :movable="false"
            :show-priority="true"
            @toggle="toggleTodo"
            @update="updateTodo"
            @remove="scheduleDelete"
          />
        </template>
      </ul>
      <div v-else-if="visibleTodos.length" class="priority-board" aria-label="優先度別Todo">
        <section
          v-for="lane in groupedTodos"
          :key="lane.key"
          class="priority-lane"
          :class="[`priority-lane-${lane.key}`, { 'is-drop-target': activeDropPriority === lane.value }]"
          :data-priority-lane="lane.key"
          :aria-label="`優先度${lane.label}、${lane.todos.length}件`"
        >
          <header class="priority-lane-header">
            <span class="priority-lane-marker" aria-hidden="true" />
            <div>
              <h2>{{ lane.label }}</h2>
              <p>{{ lane.hint }}</p>
            </div>
            <span class="priority-lane-count">
              {{ activeDropPriority === lane.value ? "移動先" : lane.todos.length }}
            </span>
          </header>
          <ul v-if="lane.todos.length" class="todo-list">
            <template v-for="todo in lane.todos" :key="todo.id">
              <StackedTodoItem
                v-if="isStackedTodo(todo)"
                :todo="todo"
                :children="childrenFor(todo.id)"
                :parents="stackedParents"
                :busy-ids="busyIds"
                :show-priority="false"
                :drop-target="activeDropParentId === todo.id"
                @toggle="toggleTodo"
                @update="updateTodo"
                @remove="scheduleDelete"
                @create-child="createTodo"
                @move-child="moveChild"
                @reorder-child="reorderChild"
                @drag-start="startPriorityDrag"
                @priority-change="changePriority"
              />
              <TodoItem
                v-else
                :todo="todo"
                :busy="busyIds.has(todo.id)"
                :show-priority="false"
                @toggle="toggleTodo"
                @update="updateTodo"
                @remove="scheduleDelete"
                @drag-start="startPriorityDrag"
                @priority-change="changePriority"
              />
            </template>
          </ul>
          <p v-else class="priority-lane-empty">ここへTodoを移動</p>
        </section>
      </div>
      <div v-else class="empty-state">
        <span aria-hidden="true">✓</span>
        <p>{{ emptyMessage }}</p>
      </div>
    </section>

    <footer class="app-footer">
      <span>Todo, quietly kept in sync.</span>
      <span aria-hidden="true">LINE → AWS → you</span>
    </footer>

    <div v-if="pendingDelete" class="undo-toast" role="status">
      <span>Todoを削除しました</span>
      <button type="button" @click="undoDelete">元に戻す</button>
    </div>
    <div v-else-if="pendingCompletion" class="undo-toast" role="status">
      <span>Todoを完了にしました</span>
      <button type="button" @click="undoCompletion">元に戻す</button>
    </div>

    <div
      v-if="dragging"
      class="drag-ghost"
      :style="{ transform: `translate3d(${dragging.x + 16}px, ${dragging.y + 16}px, 0)` }"
      aria-hidden="true"
    >
      <span>{{ activeDropParentId ? "Stacked Todoへ移動" : "優先度を移動" }}</span>
      <strong>{{ dragging.todo.title }}</strong>
    </div>
    <p class="sr-only" aria-live="polite">{{ dragAnnouncement }}</p>
  </main>
</template>
