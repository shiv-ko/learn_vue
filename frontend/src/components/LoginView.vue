<script setup lang="ts">
import { ref } from "vue";

// App.vueからもらうprops(handleLoginを渡している)
const props = defineProps<{
  login: (credentials: { email: string; password: string }) => Promise<void>;
}>();

const email = ref("");
const password = ref("");
const loading = ref(false);
const errorMessage = ref("");

async function submit() {
  errorMessage.value = "";
  loading.value = true;
  try {
    await props.login({ email: email.value, password: password.value });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "ログインできませんでした。";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-shell">
    <section class="login-story" aria-labelledby="login-title">
      <p class="eyebrow">PERSONAL TODO</p>
      <h1 id="login-title"><span>Today,</span><br />one thing at a time.</h1>
      <p class="login-copy">PCでもスマホでも、やることは同じ場所へ。LINEから追加したTodoもここに並びます。</p>
      <div class="sync-note">
        <span class="sync-mark" aria-hidden="true">↗</span>
        <span>LINEからの追加と自動同期</span>
      </div>
    </section>

    <section class="login-panel" aria-label="ログイン">
      <div class="login-form-wrap">
        <p class="eyebrow">WELCOME BACK</p>
        <h2>ログイン</h2>
        <p class="form-intro">Cognitoに登録したメールアドレスで続けます。</p>
        <!-- @submit.preventでformの送信イベント（postなど）を止めて、独自のsubmit()関数を呼ぶよという意味 -->
        <!-- デフォルトでformは指定されたURLへPOSTし、ページを再読み込みしてしまうので、止める(実際はcognitoを呼びたい) -->
        <form @submit.prevent="submit">
          <!-- labelで何をするところなのかを表現 -->
          <!-- forの要素名をinputのidと一緒にさせることで、両者が紐づく。これにより、メールアドレスという文字をクリックしたときに入力欄へフォーカス。スクリーンリーダなどのメリット -->
          <label for="email">メールアドレス</label>
          <!--  -->
          <input
            id="email"
            v-model="email"
            name="email"
            type="email"
            autocomplete="username"
            required
          />

          <label for="password">パスワード</label>
          <input
            id="password"
            v-model="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />

          <p class="form-message" :class="{ 'form-error': errorMessage }" role="alert">{{ errorMessage }}</p>

          <button class="primary-button" type="submit" :disabled="loading">
            <span v-if="loading" class="spinner spinner-small" aria-hidden="true" />
            {{ loading ? "確認中" : "ログイン" }}
          </button>
        </form>
      </div>
    </section>
  </main>
</template>
