<script setup lang="ts">
import { ref, watch } from "vue";
import { formatTagInput, parseTagInput } from "../tags";
import type { Priority, Todo, TodoKind, UpdateTodoInput } from "../types";
import MarkdownNoteField from "./MarkdownNoteField.vue";

const props = withDefaults(
  defineProps<{
    todo: Todo;
    busy?: boolean;
    deletable?: boolean;
    deleteRequiresDone?: boolean;
    movable?: boolean;
    showPriority?: boolean;
    as?: "li" | "div";
    canChangeKind?: boolean;
    toggleDisabled?: boolean;
  }>(),
  {
    deletable: false,
    deleteRequiresDone: true,
    movable: true,
    showPriority: true,
    as: "li",
    canChangeKind: true,
    toggleDisabled: false,
  },
);
const emit = defineEmits<{
  toggle: [todo: Todo];
  update: [todo: Todo, input: UpdateTodoInput];
  remove: [todo: Todo];
  dragStart: [todo: Todo, event: PointerEvent];
  priorityChange: [todo: Todo, priority: Priority | null];
}>();

const editing = ref(false);
const title = ref(props.todo.title);
const dueDate = ref(props.todo.dueDate ?? "");
const priority = ref<Priority | "">(props.todo.priority ?? "");
const memo = ref(props.todo.memo ?? "");
const note = ref(props.todo.note ?? "");
const tagsText = ref(formatTagInput(props.todo.tags));
const kind = ref<TodoKind>(props.todo.kind ?? "standard");

watch(
  () => props.todo,
  (todo) => {
    title.value = todo.title;
    dueDate.value = todo.dueDate ?? "";
    priority.value = todo.priority ?? "";
    memo.value = todo.memo ?? "";
    note.value = todo.note ?? "";
    tagsText.value = formatTagInput(todo.tags);
    kind.value = todo.kind ?? "standard";
  },
);

function save() {
  const cleanTitle = title.value.trim();
  if (!cleanTitle) return;
  emit("update", props.todo, {
    title: cleanTitle,
    dueDate: dueDate.value,
    priority: priority.value || null,
    memo: memo.value.trim(),
    note: note.value,
    tags: parseTagInput(tagsText.value),
    ...(props.canChangeKind ? { kind: kind.value } : {}),
  });
  editing.value = false;
}

function cancel() {
  title.value = props.todo.title;
  dueDate.value = props.todo.dueDate ?? "";
  priority.value = props.todo.priority ?? "";
  memo.value = props.todo.memo ?? "";
  note.value = props.todo.note ?? "";
  tagsText.value = formatTagInput(props.todo.tags);
  kind.value = props.todo.kind ?? "standard";
  editing.value = false;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", weekday: "short" }).format(
    new Date(`${value}T00:00:00`),
  );
}

const priorityLabel = { high: "優先度 高", medium: "優先度 中", low: "優先度 小" } as const;
const priorityOrder: Array<Priority | null> = ["high", "medium", "low", null];

function movePriority(direction: -1 | 1) {
  const currentIndex = priorityOrder.indexOf(props.todo.priority ?? null);
  const nextIndex = Math.min(priorityOrder.length - 1, Math.max(0, currentIndex + direction));
  const nextPriority = priorityOrder[nextIndex];
  if (nextPriority !== priorityOrder[currentIndex]) {
    emit("priorityChange", props.todo, nextPriority);
  }
}

function handlePriorityKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  movePriority(event.key === "ArrowUp" ? -1 : 1);
}
</script>

<template>
  <component :is="as" class="todo-item" :class="{ 'is-done': todo.done, 'is-busy': busy, 'is-movable': movable }">
    <template v-if="!editing">
      <button
        v-if="movable"
        :id="`priority-handle-${todo.id}`"
        class="drag-handle"
        type="button"
        :disabled="busy || toggleDisabled"
        :aria-label="`${todo.title}を優先度レーンまたはStacked Todoへ移動。上下キーで優先度も変更できます`"
        @pointerdown="emit('dragStart', todo, $event)"
        @keydown="handlePriorityKeydown"
      >
        <span aria-hidden="true"><i /><i /><i /></span>
      </button>

      <button
        class="check-button"
        type="button"
        :aria-label="todo.done ? `${todo.title}を未完了に戻す` : `${todo.title}を完了にする`"
        :aria-pressed="todo.done"
        :disabled="busy"
        @click="emit('toggle', todo)"
      >
        <span aria-hidden="true">{{ todo.done ? "✓" : "" }}</span>
      </button>

      <button class="todo-content" type="button" :disabled="busy" @click="editing = true">
        <span class="todo-title">{{ todo.title }}</span>
        <span v-if="(todo.kind ?? 'standard') === 'stacked'" class="stacked-badge">Stacked</span>
        <span
          v-if="todo.dueDate || (showPriority && todo.priority) || todo.memo || todo.tags?.length"
          class="todo-meta"
        >
          <span v-if="todo.dueDate">{{ formatDate(todo.dueDate) }}</span>
          <span v-if="showPriority && todo.priority" :class="`priority-${todo.priority}`">
            {{ priorityLabel[todo.priority] }}
          </span>
          <span v-if="todo.memo">{{ todo.memo }}</span>
          <span v-if="todo.tags?.length" class="todo-tags" aria-label="タグ">
            <span v-for="tag in todo.tags" :key="tag" class="tag-chip">{{ tag }}</span>
          </span>
        </span>
      </button>

      <button
        v-if="deletable && (!deleteRequiresDone || todo.done)"
        class="icon-button delete-button"
        type="button"
        :disabled="busy"
        aria-label="削除"
        @click="emit('remove', todo)"
      >
        <span aria-hidden="true">×</span>
      </button>
    </template>

    <form v-else class="edit-form" @submit.prevent="save">
      <label class="sr-only" :for="`edit-title-${todo.id}`">Todoの内容</label>
      <input :id="`edit-title-${todo.id}`" v-model="title" maxlength="200" required />
      <div class="edit-details">
        <label v-if="canChangeKind" class="edit-kind">
          <span>種類</span>
          <select v-model="kind">
            <option value="standard">通常</option>
            <option value="stacked">Stacked</option>
          </select>
        </label>
        <label>
          <span>期限</span>
          <input v-model="dueDate" type="date" />
        </label>
        <label>
          <span>優先度</span>
          <select v-model="priority">
            <option value="">指定なし</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">小</option>
          </select>
        </label>
        <label class="edit-memo">
          <span>メモ</span>
          <input v-model="memo" maxlength="500" />
        </label>
        <label class="edit-tags">
          <span>タグ</span>
          <input v-model="tagsText" maxlength="300" placeholder="仕事, 買い物, 今週" />
        </label>
      </div>
      <MarkdownNoteField :id="`edit-note-${todo.id}`" v-model="note" />
      <div class="edit-actions">
        <button class="text-button" type="button" @click="cancel">キャンセル</button>
        <button class="chip-button" type="submit">保存</button>
      </div>
    </form>
  </component>
</template>
