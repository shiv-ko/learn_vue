<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

const props = defineProps<{
  id: string;
  modelValue: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const copyState = ref<"idle" | "copying" | "copied" | "error">("idle");
let resetTimer: number | undefined;

const canCopy = computed(() => props.modelValue.trim().length > 0);
const copyLabel = computed(() => {
  if (copyState.value === "copying") return "コピー中";
  if (copyState.value === "copied") return "コピー済み";
  return "コピー";
});

function updateValue(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  if (copyState.value !== "idle") copyState.value = "idle";
}

async function copyNote() {
  if (!canCopy.value || copyState.value === "copying") return;
  window.clearTimeout(resetTimer);
  copyState.value = "copying";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable");
    await navigator.clipboard.writeText(props.modelValue);
    copyState.value = "copied";
    resetTimer = window.setTimeout(() => {
      copyState.value = "idle";
    }, 2_500);
  } catch {
    copyState.value = "error";
  }
}

function resetCopiedState() {
  if (copyState.value === "copied") copyState.value = "idle";
}

onBeforeUnmount(() => window.clearTimeout(resetTimer));
</script>

<template>
  <div class="markdown-note-field">
    <div class="markdown-note-heading">
      <label :for="id">理解したいこと <span>Markdown</span></label>
      <button
        class="note-copy-button"
        type="button"
        :disabled="!canCopy || copyState === 'copying'"
        :data-state="copyState"
        @click="copyNote"
        @mouseleave="resetCopiedState"
      >
        {{ copyLabel }}
      </button>
    </div>
    <textarea
      :id="id"
      :value="modelValue"
      rows="6"
      maxlength="20000"
      placeholder="# 理解したいこと&#10;このテーマを前提から順に学びたい"
      :aria-describedby="`${id}-help ${id}-status`"
      @input="updateValue"
    />
    <span :id="`${id}-help`" class="field-help">一覧には表示されません。そのままコピーして使えます。</span>
    <span
      :id="`${id}-status`"
      class="note-copy-status"
      :class="{ 'is-error': copyState === 'error' }"
      aria-live="polite"
    >
      {{ copyState === "error" ? "コピーできませんでした。文章を選択してコピーしてください。" : "" }}
    </span>
  </div>
</template>
