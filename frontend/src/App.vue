<script setup lang="ts">
import { onMounted, ref } from "vue";
import LoginView from "./components/LoginView.vue";
import TodoWorkspace from "./components/TodoWorkspace.vue";
import { getCurrentToken, signIn, signOut } from "./auth";

const token = ref<string | null>(null);
const checkingSession = ref(true);

onMounted(async () => {
  token.value = await getCurrentToken();
  checkingSession.value = false;
});

// credentialsというオブジェクトを渡す
// tokenの設定はここで行う（loginview側で行うと、親側（App.vue)に別途渡すことが必要）
// まぁemitでもできる
async function handleLogin(credentials: { email: string; password: string }) {
  token.value = await signIn(credentials.email, credentials.password);
}

function handleLogout() {
  signOut();
  token.value = null;
}
</script>

<template>
  <!-- ariaはスクリーンリーダなどの支援技術へ情報を伝えるためのタグ-->
  <main v-if="checkingSession" class="session-check" aria-live="polite">
    <!-- aria-hiddenはスクリーンリーダに読み上げさせない -->
    <span class="spinner" aria-hidden="true" />
    <p>セッションを確認しています</p>
  </main>
  <!-- v-else-ifでtokenがtruthyかを確認(テンプレート内では.valueがいらない) -->
  <!-- :token="token"でTodoWorkspaceの方にPropsを渡している -->
  <TodoWorkspace v-else-if="token" :token="token" @logout="handleLogout" />
  <!-- :loginでPropsを渡す -->
  <LoginView v-else :login="handleLogin" />
</template>
