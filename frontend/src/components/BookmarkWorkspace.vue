<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError, bookmarkApi } from "../api";
import type { Bookmark, BookmarkStatus, UpdateBookmarkInput } from "../types";

const props = defineProps<{ token: string }>();
const emit = defineEmits<{ logout: []; showTodos: [] }>();

const bookmarks = ref<Bookmark[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const busyIds = ref(new Set<string>());
const errorMessage = ref("");
const query = ref("");
const statusFilter = ref<BookmarkStatus | "all">("all");
const selectedTag = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editForm = ref({ title: "", url: "", memo: "", tags: "" });
const lastSyncedAt = ref<Date | null>(null);
const pendingDelete = ref<{ bookmark: Bookmark; timer: number } | null>(null);
let pollTimer: number | undefined;

const statusOptions: Array<{ value: BookmarkStatus; label: string }> = [
  { value: "inbox", label: "未整理" },
  { value: "reading", label: "読書中" },
  { value: "read", label: "読了" },
  { value: "archive", label: "保管" },
];

const availableTags = computed(() => {
  const counts = new Map<string, number>();
  for (const bookmark of bookmarks.value) {
    for (const tag of bookmark.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b, "ja"));
});

const visibleBookmarks = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase();
  return bookmarks.value
    .filter((bookmark) => statusFilter.value === "all" || bookmark.status === statusFilter.value)
    .filter((bookmark) => !selectedTag.value || bookmark.tags.includes(selectedTag.value))
    .filter((bookmark) => {
      if (!normalizedQuery) return true;
      return [bookmark.title, bookmark.url, bookmark.siteName, bookmark.memo]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));
});

const inboxCount = computed(() => bookmarks.value.filter((bookmark) => bookmark.status === "inbox").length);

async function loadBookmarks(silent = false) {
  if (silent) refreshing.value = true;
  else loading.value = true;
  errorMessage.value = "";
  try {
    bookmarks.value = await bookmarkApi.list(props.token);
    lastSyncedAt.value = new Date();
  } catch (error) {
    handleError(error);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function updateBookmark(bookmark: Bookmark, input: UpdateBookmarkInput, optimistic = false) {
  const previous = bookmark;
  if (optimistic) {
    bookmarks.value = bookmarks.value.map((item) =>
      item.id === bookmark.id ? { ...item, ...input } as Bookmark : item,
    );
  }
  markBusy(bookmark.id, true);
  errorMessage.value = "";
  try {
    const updated = await bookmarkApi.update(props.token, bookmark.id, input);
    bookmarks.value = bookmarks.value.map((item) => item.id === bookmark.id ? updated : item);
    if (editingId.value === bookmark.id) editingId.value = null;
  } catch (error) {
    if (optimistic) {
      bookmarks.value = bookmarks.value.map((item) => item.id === bookmark.id ? previous : item);
    }
    handleError(error);
  } finally {
    markBusy(bookmark.id, false);
  }
}

function beginEdit(bookmark: Bookmark) {
  editingId.value = bookmark.id;
  editForm.value = {
    title: bookmark.title ?? "",
    url: bookmark.url,
    memo: bookmark.memo ?? "",
    tags: bookmark.tags.join(", "),
  };
}

function saveEdit(bookmark: Bookmark) {
  const tags = [...new Map(editForm.value.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => [tag.toLocaleLowerCase(), tag])).values()];
  void updateBookmark(bookmark, {
    title: editForm.value.title.trim() || null,
    url: editForm.value.url.trim(),
    memo: editForm.value.memo || null,
    tags,
  });
}

function scheduleDelete(bookmark: Bookmark) {
  if (pendingDelete.value) void commitDelete(pendingDelete.value.bookmark);
  bookmarks.value = bookmarks.value.filter((item) => item.id !== bookmark.id);
  const timer = window.setTimeout(() => void commitDelete(bookmark), 5_000);
  pendingDelete.value = { bookmark, timer };
}

function undoDelete() {
  if (!pendingDelete.value) return;
  window.clearTimeout(pendingDelete.value.timer);
  bookmarks.value = [pendingDelete.value.bookmark, ...bookmarks.value];
  pendingDelete.value = null;
}

async function commitDelete(bookmark: Bookmark) {
  if (pendingDelete.value?.bookmark.id === bookmark.id) {
    window.clearTimeout(pendingDelete.value.timer);
    pendingDelete.value = null;
  }
  try {
    await bookmarkApi.remove(props.token, bookmark.id);
  } catch (error) {
    bookmarks.value = [bookmark, ...bookmarks.value];
    handleError(error);
  }
}

function markBusy(id: string, busy: boolean) {
  const next = new Set(busyIds.value);
  if (busy) next.add(id);
  else next.delete(id);
  busyIds.value = next;
}

function statusLabel(status: BookmarkStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function hostFor(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function handleError(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    errorMessage.value = "セッションの有効期限が切れました。もう一度ログインしてください。";
    window.setTimeout(() => emit("logout"), 1_500);
    return;
  }
  errorMessage.value = error instanceof Error ? error.message : "操作に失敗しました。";
}

onMounted(() => {
  void loadBookmarks();
  pollTimer = window.setInterval(() => void loadBookmarks(true), 15_000);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
  if (pendingDelete.value) window.clearTimeout(pendingDelete.value.timer);
});
</script>

<template>
  <main class="workspace-shell">
    <header class="app-header">
      <a class="wordmark" href="#bookmarks-top" aria-label="あとで読む ホーム">Todo.</a>
      <nav class="view-switch" aria-label="表示する機能">
        <button type="button" class="view-switch-button" @click="emit('showTodos')">Todo</button>
        <button type="button" class="view-switch-button is-active" aria-current="page">あとで読む</button>
      </nav>
      <div class="header-actions">
        <span class="sync-status" aria-live="polite">
          <span class="status-dot" :class="{ 'is-refreshing': refreshing }" aria-hidden="true" />
          {{ refreshing ? "同期中" : lastSyncedAt ? "同期済み" : "接続中" }}
        </span>
        <button class="text-button" type="button" @click="emit('logout')">ログアウト</button>
      </div>
    </header>

    <section id="bookmarks-top" class="workspace bookmark-workspace">
      <div class="workspace-heading bookmark-heading">
        <div>
          <p class="eyebrow">READING QUEUE</p>
          <h1>あとで読む</h1>
        </div>
        <p class="remaining-count"><strong>{{ inboxCount }}</strong><span>件 未整理です</span></p>
      </div>

      <div class="bookmark-tools">
        <label class="bookmark-search">
          <span class="sr-only">Bookmarkを検索</span>
          <input v-model="query" type="search" placeholder="タイトル、URL、サイト、メモを検索" />
        </label>
        <button class="icon-button refresh-button" type="button" :disabled="refreshing" aria-label="再読み込み" @click="loadBookmarks(true)">
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <div class="list-toolbar bookmark-toolbar">
        <div class="filter-tabs" role="group" aria-label="状態で絞り込み">
          <button
            v-for="option in ([['all', 'すべて'], ['inbox', '未整理'], ['reading', '読書中'], ['read', '読了'], ['archive', '保管']] as const)"
            :key="option[0]"
            class="filter-button"
            :class="{ 'is-active': statusFilter === option[0] }"
            type="button"
            :aria-pressed="statusFilter === option[0]"
            @click="statusFilter = option[0]"
          >{{ option[1] }}</button>
        </div>
      </div>

      <div v-if="availableTags.length" class="tag-filter" role="group" aria-label="タグで絞り込み">
        <span class="tag-filter-label">タグ</span>
        <button class="tag-filter-button" :class="{ 'is-active': selectedTag === null }" type="button" :aria-pressed="selectedTag === null" @click="selectedTag = null">すべて</button>
        <button
          v-for="([tag, count]) in availableTags"
          :key="tag"
          class="tag-filter-button"
          :class="{ 'is-active': selectedTag === tag }"
          type="button"
          :aria-pressed="selectedTag === tag"
          @click="selectedTag = selectedTag === tag ? null : tag"
        >{{ tag }} <span aria-hidden="true">{{ count }}</span></button>
      </div>

      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <div v-if="loading" class="list-loading" aria-live="polite">
        <span class="spinner" aria-hidden="true" />
        <span>Bookmarkを読み込んでいます</span>
      </div>
      <div v-else-if="visibleBookmarks.length" class="bookmark-list">
        <article v-for="bookmark in visibleBookmarks" :key="bookmark.id" class="bookmark-card" :class="{ 'is-busy': busyIds.has(bookmark.id) }">
          <div class="bookmark-card-main">
            <div class="bookmark-site-line">
              <span>{{ bookmark.siteName ?? hostFor(bookmark.url) }}</span>
              <span v-if="bookmark.metadataStatus === 'pending'" class="metadata-state">情報を取得中</span>
              <span v-else-if="bookmark.metadataStatus === 'failed'" class="metadata-state is-failed">URLのみ保存済み</span>
            </div>
            <h2><a :href="bookmark.url" target="_blank" rel="noreferrer">{{ bookmark.title || bookmark.url }}</a></h2>
            <p v-if="bookmark.description" class="bookmark-description">{{ bookmark.description }}</p>
            <a class="bookmark-url" :href="bookmark.url" target="_blank" rel="noreferrer">{{ bookmark.url }}</a>
            <p v-if="bookmark.memo" class="bookmark-memo">{{ bookmark.memo }}</p>
            <div v-if="bookmark.tags.length" class="bookmark-tags" aria-label="タグ">
              <button v-for="tag in bookmark.tags" :key="tag" type="button" @click="selectedTag = tag">#{{ tag }}</button>
            </div>
          </div>

          <div class="bookmark-actions">
            <button class="favorite-button" type="button" :aria-pressed="bookmark.favorite" :aria-label="bookmark.favorite ? 'お気に入りから外す' : 'お気に入りに追加'" :disabled="busyIds.has(bookmark.id)" @click="updateBookmark(bookmark, { favorite: !bookmark.favorite }, true)">
              <span aria-hidden="true">{{ bookmark.favorite ? "★" : "☆" }}</span>
            </button>
            <label class="status-select">
              <span class="sr-only">状態</span>
              <select :value="bookmark.status" :disabled="busyIds.has(bookmark.id)" @change="updateBookmark(bookmark, { status: ($event.target as HTMLSelectElement).value as BookmarkStatus }, true)">
                <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <button class="text-button" type="button" :disabled="busyIds.has(bookmark.id)" @click="beginEdit(bookmark)">編集</button>
            <button class="text-button danger-button" type="button" :disabled="busyIds.has(bookmark.id)" @click="scheduleDelete(bookmark)">削除</button>
          </div>

          <form v-if="editingId === bookmark.id" class="bookmark-edit" @submit.prevent="saveEdit(bookmark)">
            <label>タイトル<input v-model="editForm.title" maxlength="500" /></label>
            <label>URL<input v-model="editForm.url" type="url" maxlength="2048" required /></label>
            <label>メモ<textarea v-model="editForm.memo" maxlength="2000" /></label>
            <label>タグ（カンマ区切り）<input v-model="editForm.tags" /></label>
            <div class="bookmark-edit-actions">
              <button class="primary-button" type="submit" :disabled="busyIds.has(bookmark.id)">保存</button>
              <button class="text-button" type="button" @click="editingId = null">キャンセル</button>
            </div>
          </form>
          <span class="sr-only">現在の状態: {{ statusLabel(bookmark.status) }}</span>
        </article>
      </div>
      <div v-else class="empty-state">
        <span aria-hidden="true">↗</span>
        <p>{{ query || selectedTag || statusFilter !== 'all' ? "条件に合うBookmarkはありません。" : "LINEやAndroidからリンクを送ると、ここに並びます。" }}</p>
      </div>
    </section>

    <footer class="app-footer">
      <span>Links, ready when you are.</span>
      <span aria-hidden="true">LINE + Android → AWS → you</span>
    </footer>

    <div v-if="pendingDelete" class="undo-toast" role="status">
      <span>Bookmarkを削除しました</span>
      <button type="button" @click="undoDelete">元に戻す</button>
    </div>
  </main>
</template>
