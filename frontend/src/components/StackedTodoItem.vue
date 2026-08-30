<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CreateTodoInput, Priority, Todo, UpdateTodoInput } from "../types";
import TodoItem from "./TodoItem.vue";

const props = defineProps<{
  todo: Todo;
  children: Todo[];
  parents: Todo[];
  busyIds: Set<string>;
  showPriority?: boolean;
  movable?: boolean;
  dropTarget?: boolean;
}>();

const emit = defineEmits<{
  toggle: [todo: Todo];
  update: [todo: Todo, input: UpdateTodoInput];
  remove: [todo: Todo];
  createChild: [input: CreateTodoInput];
  moveChild: [todo: Todo, parentId: string | null];
  reorderChild: [todo: Todo, position: number];
  dragStart: [todo: Todo, event: PointerEvent];
  priorityChange: [todo: Todo, priority: Priority | null];
}>();

const expanded = ref(false);
const childTitle = ref("");
const stackedTodo = computed<Todo>(() => ({ ...props.todo, kind: "stacked" }));

watch(
  () => props.dropTarget,
  (isTarget) => {
    if (isTarget) expanded.value = true;
  },
);

function addChild() {
  const title = childTitle.value.trim();
  if (!title) return;
  emit("createChild", {
    title,
    parentId: props.todo.id,
    position: props.children.length,
  });
  childTitle.value = "";
  expanded.value = true;
}

function moveChild(child: Todo, event: Event) {
  const parentId = (event.target as HTMLSelectElement).value;
  if (parentId === "") emit("moveChild", child, null);
  else if (parentId !== child.parentId) emit("moveChild", child, parentId);
}
</script>

<template>
  <li
    class="stacked-todo"
    :class="{ 'is-stack-drop-target': dropTarget }"
    :data-stack-parent="todo.id"
  >
    <TodoItem
      as="div"
      :todo="stackedTodo"
      :busy="busyIds.has(todo.id)"
      :deletable="true"
      :delete-requires-done="false"
      :show-priority="showPriority"
      :movable="movable"
      :toggle-disabled="children.length > 0"
      @toggle="emit('toggle', $event)"
      @update="(item, input) => emit('update', item, input)"
      @remove="emit('remove', $event)"
      @drag-start="(item, event) => emit('dragStart', item, event)"
      @priority-change="(item, priority) => emit('priorityChange', item, priority)"
    />

    <button
      class="stack-toggle"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="`children-${todo.id}`"
      @click="expanded = !expanded"
    >
      <span>{{ dropTarget ? "ここに入れる" : `${children.filter((child) => child.done).length}/${children.length} 完了` }}</span>
      <span class="stack-progress" aria-hidden="true">
        <i :style="{ width: `${children.length ? (children.filter((child) => child.done).length / children.length) * 100 : 0}%` }" />
      </span>
      <span aria-hidden="true">{{ expanded ? "−" : "+" }}</span>
    </button>

    <div v-show="expanded" :id="`children-${todo.id}`" class="stack-children">
      <ul v-if="children.length" class="child-todo-list">
        <li v-for="(child, index) in children" :key="child.id" class="child-todo-shell">
          <TodoItem
            as="div"
            :todo="child"
            :busy="busyIds.has(child.id)"
            :deletable="child.done"
            :movable="false"
            :can-change-kind="false"
            :show-priority="true"
            @toggle="emit('toggle', $event)"
            @update="(item, input) => emit('update', item, input)"
            @remove="emit('remove', $event)"
          />
          <div class="child-structure-actions" aria-label="子Todoの並びと移動">
            <button
              type="button"
              :disabled="index === 0 || busyIds.has(child.id)"
              :aria-label="`${child.title}を上へ移動`"
              @click="emit('reorderChild', child, index - 1)"
            >↑</button>
            <button
              type="button"
              :disabled="index === children.length - 1 || busyIds.has(child.id)"
              :aria-label="`${child.title}を下へ移動`"
              @click="emit('reorderChild', child, index + 1)"
            >↓</button>
            <label>
              <span class="sr-only">移動先のStacked Todo</span>
              <select :value="todo.id" :disabled="busyIds.has(child.id)" @change="moveChild(child, $event)">
                <option value="">通常Todoに戻す</option>
                <option v-for="parent in parents" :key="parent.id" :value="parent.id">
                  {{ parent.title }}
                </option>
              </select>
            </label>
          </div>
        </li>
      </ul>
      <p v-else class="stack-empty">子Todoを追加すると、ここに順番に並びます。</p>
      <form class="child-composer" @submit.prevent="addChild">
        <label class="sr-only" :for="`child-title-${todo.id}`">子Todo</label>
        <input
          :id="`child-title-${todo.id}`"
          v-model="childTitle"
          maxlength="200"
          placeholder="子Todoを追加"
          required
        />
        <button class="chip-button" type="submit" :disabled="!childTitle.trim()">追加</button>
      </form>
    </div>
  </li>
</template>
