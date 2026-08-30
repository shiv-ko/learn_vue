<script setup lang="ts">
import { ref } from "vue";
import { parseTagInput } from "../tags";
import type { CreateTodoInput, Priority, TodoKind } from "../types";
import MarkdownNoteField from "./MarkdownNoteField.vue";

defineProps<{ saving: boolean }>();
const emit = defineEmits<{ create: [input: CreateTodoInput] }>();

const title = ref("");
const dueDate = ref("");
const priority = ref<Priority | "">("");
const memo = ref("");
const note = ref("");
const tagsText = ref("");
const kind = ref<TodoKind>("standard");
const expanded = ref(false);

function submit() {
  const cleanTitle = title.value.trim();
  if (!cleanTitle) return;
  emit("create", {
    title: cleanTitle,
    ...(dueDate.value ? { dueDate: dueDate.value } : {}),
    ...(priority.value ? { priority: priority.value } : {}),
    ...(memo.value.trim() ? { memo: memo.value.trim() } : {}),
    ...(note.value.trim() ? { note: note.value } : {}),
    tags: parseTagInput(tagsText.value),
    kind: kind.value,
  });
  title.value = "";
  dueDate.value = "";
  priority.value = "";
  memo.value = "";
  note.value = "";
  tagsText.value = "";
  kind.value = "standard";
  expanded.value = false;
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div class="composer-main">
      <label class="sr-only" for="todo-title">新しいTodo</label>
      <input
        id="todo-title"
        v-model="title"
        type="text"
        maxlength="200"
        placeholder="次にやることは？"
        required
        @focus="expanded = true"
      />
      <button class="primary-button composer-submit" type="submit" :disabled="saving || !title.trim()">
        {{ saving ? "追加中" : "追加" }}
      </button>
    </div>

    <div v-if="expanded" class="composer-details">
      <fieldset class="todo-kind-picker field-group-wide">
        <legend>種類</legend>
        <label :class="{ 'is-selected': kind === 'standard' }">
          <input v-model="kind" type="radio" value="standard" />
          <span><strong>通常</strong><small>1件で完結するTodo</small></span>
        </label>
        <label :class="{ 'is-selected': kind === 'stacked' }">
          <input v-model="kind" type="radio" value="stacked" />
          <span><strong>Stacked</strong><small>複数の作業を束ねるTodo</small></span>
        </label>
      </fieldset>
      <div class="field-group">
        <label for="todo-due-date">期限</label>
        <input id="todo-due-date" v-model="dueDate" type="date" />
      </div>
      <div class="field-group">
        <label for="todo-priority">優先度</label>
        <select id="todo-priority" v-model="priority">
          <option value="">指定なし</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">小</option>
        </select>
      </div>
      <div class="field-group field-group-wide">
        <label for="todo-memo">メモ</label>
        <input id="todo-memo" v-model="memo" type="text" maxlength="500" placeholder="補足があれば" />
      </div>
      <div class="field-group field-group-wide">
        <label for="todo-tags">タグ</label>
        <input
          id="todo-tags"
          v-model="tagsText"
          type="text"
          maxlength="300"
          placeholder="仕事, 買い物, 今週"
          aria-describedby="todo-tags-help"
        />
        <span id="todo-tags-help" class="field-help">カンマ区切りで10個まで</span>
      </div>
      <MarkdownNoteField id="todo-note" v-model="note" class="field-group-wide" />
    </div>
  </form>
</template>
