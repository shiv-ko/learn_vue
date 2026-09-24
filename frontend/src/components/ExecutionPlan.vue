<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Todo } from "../types";

const STORAGE_KEY = "todo.execution-plan.v1";

const props = defineProps<{
  todos: Todo[];
  busyIds: Set<string>;
  errorMessage?: string;
}>();
const emit = defineEmits<{ toggle: [todo: Todo] }>();

const orderedIds = ref<string[]>(readStoredOrder());
const searchQuery = ref("");
const searchOpen = ref(false);
const activeOptionIndex = ref(-1);
const storageError = ref("");
const announcement = ref("");
const dragging = ref<{ id: string; pointerId: number } | null>(null);
const detailDialog = ref<HTMLDialogElement | null>(null);
const detailHeading = ref<HTMLElement | null>(null);
const selectedDetailTodo = ref<Todo | null>(null);

const childParentIds = computed(
  () => new Set(props.todos.flatMap((todo) => (todo.parentId ? [todo.parentId] : []))),
);
const actionableTodos = computed(() =>
  props.todos.filter(
    (todo) =>
      !todo.done &&
      (todo.kind ?? "standard") !== "stacked" &&
      !childParentIds.value.has(todo.id),
  ),
);
const planItems = computed(() => {
  const byId = new Map(actionableTodos.value.map((todo) => [todo.id, todo]));
  return orderedIds.value.flatMap((id) => {
    const todo = byId.get(id);
    return todo ? [todo] : [];
  });
});
const availableTodos = computed(() => {
  const planned = new Set(orderedIds.value);
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  return actionableTodos.value
    .filter((todo) => !planned.has(todo.id))
    .sort(
      (a, b) =>
        (a.priority ? priorityRank[a.priority] : 3) -
          (b.priority ? priorityRank[b.priority] : 3) ||
        b.createdAt.localeCompare(a.createdAt),
    );
});

const matchingTodos = computed(() => {
  const normalizedQuery = searchQuery.value.trim().toLocaleLowerCase();
  if (!normalizedQuery) return availableTodos.value;
  return availableTodos.value.filter((todo) =>
    [todo.title, parentTitle(todo), todo.memo, todo.note, ...(todo.tags ?? [])]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery)),
  );
});
const activeOption = computed(() => matchingTodos.value[activeOptionIndex.value]);

function readStoredOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string"))];
  } catch {
    return [];
  }
}

function persistOrder(message: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(orderedIds.value));
    storageError.value = "";
    announcement.value = message;
  } catch {
    storageError.value =
      "実行順をこの端末へ保存できませんでした。ブラウザのストレージ設定を確認してください。";
  }
}

function addTodo(todo: Todo) {
  if (orderedIds.value.includes(todo.id)) return;
  orderedIds.value = [...orderedIds.value, todo.id];
  searchQuery.value = "";
  activeOptionIndex.value = -1;
  persistOrder(`${todo.title}を実行順の最後に追加しました。`);
}

function addActiveTodo() {
  if (activeOption.value) addTodo(activeOption.value);
}

function openSearch() {
  searchOpen.value = true;
}

function updateSearch() {
  searchOpen.value = true;
  activeOptionIndex.value = matchingTodos.value.length ? 0 : -1;
}

function closeSearch() {
  searchOpen.value = false;
  activeOptionIndex.value = -1;
}

function handleSearchKey(event: KeyboardEvent) {
  const count = matchingTodos.value.length;
  if (event.key === "Escape") {
    if (searchOpen.value) event.preventDefault();
    closeSearch();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  searchOpen.value = true;
  if (!count) return;
  const step = event.key === "ArrowDown" ? 1 : -1;
  activeOptionIndex.value = (activeOptionIndex.value + step + count) % count;
  void nextTick(() =>
    document
      .getElementById(`plan-option-${activeOption.value?.id}`)
      ?.scrollIntoView?.({ block: "nearest" }),
  );
}

function handleSearchFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (!next || !(event.currentTarget as HTMLElement).contains(next)) closeSearch();
}

function removeFromPlan(todo: Todo) {
  orderedIds.value = orderedIds.value.filter((id) => id !== todo.id);
  persistOrder(`${todo.title}を実行順から外しました。`);
}

function moveTodo(todo: Todo, nextIndex: number) {
  const visibleIds = planItems.value.map((item) => item.id);
  const currentIndex = visibleIds.indexOf(todo.id);
  const boundedIndex = Math.max(0, Math.min(nextIndex, planItems.value.length - 1));
  if (currentIndex < 0 || currentIndex === boundedIndex) return;

  visibleIds.splice(currentIndex, 1);
  visibleIds.splice(boundedIndex, 0, todo.id);
  const visibleSet = new Set(visibleIds);
  let visibleIndex = 0;
  orderedIds.value = orderedIds.value.map((id) =>
    visibleSet.has(id) ? visibleIds[visibleIndex++] : id,
  );
  persistOrder(`${todo.title}を${boundedIndex + 1}番目へ移動しました。`);
  void nextTick(() => document.getElementById(`plan-handle-${todo.id}`)?.focus());
}

function handleMoveKey(todo: Todo, event: KeyboardEvent) {
  const currentIndex = planItems.value.findIndex((item) => item.id === todo.id);
  const targets: Record<string, number> = {
    ArrowUp: currentIndex - 1,
    ArrowDown: currentIndex + 1,
    Home: 0,
    End: planItems.value.length - 1,
  };
  if (!(event.key in targets)) return;
  event.preventDefault();
  moveTodo(todo, targets[event.key]);
}

function startDrag(todo: Todo, event: PointerEvent) {
  if (props.busyIds.has(todo.id) || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  dragging.value = { id: todo.id, pointerId: event.pointerId };
  announcement.value = `${todo.title}を移動中です。`;
  document.body.classList.add("is-plan-dragging");
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", finishDrag);
  document.addEventListener("pointercancel", finishDrag);
}

function moveDrag(event: PointerEvent) {
  if (!dragging.value || dragging.value.pointerId !== event.pointerId) return;
  event.preventDefault();
  const targetRow = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest<HTMLElement>("[data-plan-id]");
  const targetId = targetRow?.dataset.planId;
  if (!targetId || targetId === dragging.value.id) return;

  const dragged = planItems.value.find((todo) => todo.id === dragging.value?.id);
  const targetIndex = planItems.value.findIndex((todo) => todo.id === targetId);
  if (dragged && targetIndex >= 0) moveTodo(dragged, targetIndex);

  const edge = 72;
  if (event.clientY < edge) window.scrollBy({ top: -12, behavior: "auto" });
  else if (event.clientY > window.innerHeight - edge) {
    window.scrollBy({ top: 12, behavior: "auto" });
  }
}

function finishDrag(event?: PointerEvent) {
  if (event && dragging.value && dragging.value.pointerId !== event.pointerId) return;
  const todo = planItems.value.find((item) => item.id === dragging.value?.id);
  if (todo) announcement.value = `${todo.title}の移動を終了しました。`;
  dragging.value = null;
  document.body.classList.remove("is-plan-dragging");
  document.removeEventListener("pointermove", moveDrag);
  document.removeEventListener("pointerup", finishDrag);
  document.removeEventListener("pointercancel", finishDrag);
}

function parentTitle(todo: Todo): string | undefined {
  if (!todo.parentId) return undefined;
  return props.todos.find((candidate) => candidate.id === todo.parentId)?.title;
}

function openDetails(todo: Todo) {
  selectedDetailTodo.value = todo;
  void nextTick(() => {
    if (!detailDialog.value?.open) detailDialog.value?.showModal();
    detailHeading.value?.focus({ preventScroll: true });
  });
}

function closeDetails() {
  detailDialog.value?.close();
}

function priorityLabel(todo: Todo): string {
  if (todo.priority === "high") return "高";
  if (todo.priority === "medium") return "中";
  if (todo.priority === "low") return "小";
  return "未設定";
}

function formatDueDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function hasDetailMetadata(todo: Todo): boolean {
  return Boolean(
    parentTitle(todo) ||
      todo.dueDate ||
      todo.priority ||
      todo.tags?.length ||
      todo.memo ||
      todo.note,
  );
}

function handleStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY) orderedIds.value = readStoredOrder();
}

onMounted(() => window.addEventListener("storage", handleStorage));
onBeforeUnmount(() => {
  finishDrag();
  window.removeEventListener("storage", handleStorage);
});
</script>

<template>
  <section id="plan" class="workspace plan-workspace" aria-labelledby="plan-title">
    <div class="workspace-heading plan-heading">
      <div>
        <p class="eyebrow">EXECUTION PLAN</p>
        <h1 id="plan-title">実行順</h1>
      </div>
      <p class="remaining-count"><strong>{{ planItems.length }}</strong><span>件 計画中</span></p>
    </div>

    <form class="plan-add" @submit.prevent="addActiveTodo" @focusout="handleSearchFocusOut">
      <label for="plan-todo-search">Todoを追加</label>
      <div class="plan-search">
        <input
          id="plan-todo-search"
          v-model="searchQuery"
          type="search"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          aria-controls="plan-todo-options"
          :aria-expanded="searchOpen"
          :aria-activedescendant="activeOption ? `plan-option-${activeOption.id}` : undefined"
          :placeholder="availableTodos.length ? 'タイトル、タグ、メモで検索' : '追加できるTodoはありません'"
          :disabled="availableTodos.length === 0"
          @focus="openSearch"
          @click="openSearch"
          @input="updateSearch"
          @keydown="handleSearchKey"
        />
        <ul
          v-show="searchOpen"
          id="plan-todo-options"
          class="plan-search-options"
          role="listbox"
          aria-label="未計画のTodo"
        >
          <li
            v-for="(todo, index) in matchingTodos"
            :id="`plan-option-${todo.id}`"
            :key="todo.id"
            class="plan-search-option"
            :class="{ 'is-active': index === activeOptionIndex }"
            role="option"
            :aria-selected="index === activeOptionIndex"
            @mousedown.prevent
            @mousemove="activeOptionIndex = index"
            @click="addTodo(todo)"
          >
            <span v-if="parentTitle(todo)" class="plan-search-parent">{{ parentTitle(todo) }} ›</span>
            <span class="plan-search-title">{{ todo.title }}</span>
            <span v-if="todo.tags?.length" class="plan-search-tags">{{ todo.tags.join("・") }}</span>
          </li>
          <li v-if="!matchingTodos.length" class="plan-search-empty" role="presentation">
            「{{ searchQuery.trim() }}」に合うTodoはありません
          </li>
        </ul>
      </div>
      <p>候補をクリックするか、上下キーで選んでEnterで追加します。実行順はこのブラウザに保存されます。</p>
    </form>

    <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
    <p v-if="storageError" class="inline-error" role="alert">{{ storageError }}</p>

    <ol v-if="planItems.length" class="plan-list" aria-label="Todoの実行順">
      <li
        v-for="(todo, index) in planItems"
        :key="todo.id"
        class="plan-item"
        :class="{ 'is-dragging': dragging?.id === todo.id, 'is-busy': busyIds.has(todo.id) }"
        :data-plan-id="todo.id"
      >
        <span class="plan-position" aria-hidden="true">{{ String(index + 1).padStart(2, "0") }}</span>
        <button
          :id="`plan-handle-${todo.id}`"
          class="plan-drag-handle"
          type="button"
          :disabled="busyIds.has(todo.id)"
          :aria-label="`${todo.title}を並べ替え。上下矢印キーでも移動できます`"
          @pointerdown="startDrag(todo, $event)"
          @keydown="handleMoveKey(todo, $event)"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <div class="plan-item-content">
          <p v-if="parentTitle(todo)" class="plan-parent">{{ parentTitle(todo) }}</p>
          <h2>{{ todo.title }}</h2>
          <div v-if="todo.dueDate || todo.tags?.length" class="plan-meta">
            <span v-if="todo.dueDate">期限 {{ todo.dueDate }}</span>
            <span v-for="tag in todo.tags" :key="tag">{{ tag }}</span>
          </div>
        </div>
        <div class="plan-item-actions">
          <button
            class="plan-order-button"
            type="button"
            :disabled="index === 0 || busyIds.has(todo.id)"
            :aria-label="`${todo.title}を1つ上へ`"
            @click="moveTodo(todo, index - 1)"
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            class="plan-order-button"
            type="button"
            :disabled="index === planItems.length - 1 || busyIds.has(todo.id)"
            :aria-label="`${todo.title}を1つ下へ`"
            @click="moveTodo(todo, index + 1)"
          >
            <span aria-hidden="true">↓</span>
          </button>
          <button
            class="plan-complete-button"
            type="button"
            :disabled="busyIds.has(todo.id)"
            :aria-label="`${todo.title}を完了にする`"
            @click="emit('toggle', todo)"
          >
            完了
          </button>
          <button
            class="plan-detail-button"
            type="button"
            aria-haspopup="dialog"
            :aria-label="`${todo.title}の詳細を開く`"
            @click="openDetails(todo)"
          >
            詳細
          </button>
          <button
            class="plan-remove-button"
            type="button"
            :disabled="busyIds.has(todo.id)"
            :aria-label="`${todo.title}を実行順から外す`"
            @click="removeFromPlan(todo)"
          >
            外す
          </button>
        </div>
      </li>
    </ol>

    <div v-else class="plan-empty">
      <span aria-hidden="true">→</span>
      <div>
        <h2>次にやるTodoを決めましょう</h2>
        <p>上の検索欄から追加すると、ここに実行順が表示されます。</p>
      </div>
    </div>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </section>

  <dialog
    ref="detailDialog"
    class="plan-detail-dialog"
    aria-labelledby="plan-detail-title"
    @click.self="closeDetails"
    @close="selectedDetailTodo = null"
  >
    <article v-if="selectedDetailTodo" class="plan-detail-panel">
      <header class="plan-detail-header">
        <div>
          <p class="eyebrow">TODO DETAIL</p>
          <h2 id="plan-detail-title" ref="detailHeading" tabindex="-1">
            {{ selectedDetailTodo.title }}
          </h2>
        </div>
        <button
          class="icon-button plan-detail-close"
          type="button"
          aria-label="詳細を閉じる"
          @click="closeDetails"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <dl v-if="hasDetailMetadata(selectedDetailTodo)" class="plan-detail-facts">
        <div v-if="parentTitle(selectedDetailTodo)">
          <dt>Stacked Todo</dt>
          <dd>{{ parentTitle(selectedDetailTodo) }}</dd>
        </div>
        <div>
          <dt>優先度</dt>
          <dd>{{ priorityLabel(selectedDetailTodo) }}</dd>
        </div>
        <div v-if="selectedDetailTodo.dueDate">
          <dt>期限</dt>
          <dd>{{ formatDueDate(selectedDetailTodo.dueDate) }}</dd>
        </div>
        <div v-if="selectedDetailTodo.tags?.length">
          <dt>タグ</dt>
          <dd class="plan-detail-tags">
            <span v-for="tag in selectedDetailTodo.tags" :key="tag">{{ tag }}</span>
          </dd>
        </div>
      </dl>

      <div v-if="selectedDetailTodo.memo" class="plan-detail-copy">
        <h3>メモ</h3>
        <p>{{ selectedDetailTodo.memo }}</p>
      </div>
      <div v-if="selectedDetailTodo.note" class="plan-detail-copy">
        <h3>理解したいこと</h3>
        <p>{{ selectedDetailTodo.note }}</p>
      </div>
      <p v-if="!hasDetailMetadata(selectedDetailTodo)" class="plan-detail-empty">
        追加の詳細情報はありません。
      </p>

      <footer class="plan-detail-footer">
        <button class="chip-button" type="button" @click="closeDetails">閉じる</button>
      </footer>
    </article>
  </dialog>
</template>
