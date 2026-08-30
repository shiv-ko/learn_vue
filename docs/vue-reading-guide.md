# Vueコード リーディングガイド

最終更新: 2026-08-30

## このガイドの対象と読み方

このガイドは、Vueの`ref`、`computed`、`v-model`、`v-if`などの基本文法を一通り学び、実際のコードベースを読み始めたい人向けです。

最初は「すべての行を理解する」ことを目標にしません。画面上の一つの操作を選び、データがどのファイルを通って変化するかを追うと、このアプリの設計がつかみやすくなります。初回は「おすすめの順番」から「Todoを1件追加する流れ」までを通読してください。それ以降は、調べたい機能に応じて参照します。

## 最初に全体像をつかむ

フロントエンドは`frontend/`にあるVue 3 + TypeScriptのSPAです。Vue RouterやPiniaは使っていません。画面の切り替えは`App.vue`の条件分岐、Todoの中心的な状態管理は`TodoWorkspace.vue`が担当します。

```text
index.html
  └─ src/main.ts
       └─ src/App.vue
            ├─ src/components/LoginView.vue
            └─ src/components/TodoWorkspace.vue
                 ├─ TodoComposer.vue
                 │    └─ MarkdownNoteField.vue
                 ├─ TodoItem.vue
                 │    └─ MarkdownNoteField.vue
                 └─ StackedTodoItem.vue
                      └─ TodoItem.vue
```

役割を先に把握しておくと、読む途中で迷いにくくなります。

| ファイル | 主な役割 | 最初に見るポイント |
| --- | --- | --- |
| `frontend/src/main.ts` | Vueアプリの起動 | `App`を`#app`へマウントする流れ |
| `frontend/src/App.vue` | 認証状態による画面切り替え | `token`と`checkingSession` |
| `frontend/src/components/LoginView.vue` | ログインフォーム | props、フォーム送信、エラー表示 |
| `frontend/src/types.ts` | フロントで使うデータ型 | `Todo`、作成用と更新用の型の違い |
| `frontend/src/api.ts` | Todo APIとの通信 | IDトークン、HTTPメソッド、`ApiError` |
| `frontend/src/components/TodoComposer.vue` | Todoの入力と作成依頼 | 入力値を`create`イベントへ変換する部分 |
| `frontend/src/components/TodoItem.vue` | Todo 1件の表示と編集 | propsで受け取り、イベントで操作を返す構造 |
| `frontend/src/components/TodoWorkspace.vue` | Todo画面全体の状態と処理 | API呼び出し、一覧の加工、子への値の受け渡し |
| `frontend/src/components/StackedTodoItem.vue` | 親子Todoの表示と操作 | イベントをさらに親へ渡す流れ |
| `frontend/src/components/MarkdownNoteField.vue` | Markdown入力とコピー | 独自`v-model`、ブラウザAPI、後片付け |
| `frontend/src/auth.ts` | Cognito認証 | コールバック形式の処理をPromiseへ変換する部分 |
| `frontend/src/tags.ts` | タグ文字列の整形 | Vueに依存しない純粋関数 |
| `frontend/src/styles.css`、`tokens.css` | 全画面の見た目 | コンポーネント理解後に必要なクラスだけ検索する |

## おすすめの順番は「小さい画面」から「状態の中心」へ

### 1. `main.ts`から`LoginView.vue`まで読む

まず、次の3ファイルを順に読みます。

1. `frontend/src/main.ts`
2. `frontend/src/App.vue`
3. `frontend/src/components/LoginView.vue`

この範囲だけで、Vueアプリの起動、ライフサイクル、props、イベント処理、条件付き描画を確認できます。`App.vue`のテンプレートでは、次の3状態がどの画面に対応するかを書き出してみてください。

| 状態 | 表示されるもの |
| --- | --- |
| セッション確認中 | 読み込み表示 |
| 有効な`token`がある | `TodoWorkspace` |
| `token`がない | `LoginView` |

`LoginView`は比較的小さく、親から渡された`login`関数を呼ぶだけです。認証の詳細を子コンポーネントへ持ち込んでいない点に注目します。

ここまで読んだら`frontend/src/auth.ts`を開き、`App.vue`が使う3関数の入出力だけを確認します。Cognitoライブラリ固有の処理は、認証機能を調べる段階まで後回しで構いません。

### 2. 画面より先にデータの形と通信方法を読む

次に、以下を読みます。

1. `frontend/src/types.ts`
2. `frontend/src/config.ts`
3. `frontend/src/api.ts`
4. `frontend/src/api.spec.ts`

`Todo`はAPIから返る完成済みのデータ、`CreateTodoInput`は作成時の入力、`UpdateTodoInput`は一部の項目だけを変更する入力です。型を先に読むと、コンポーネント内の値が「画面だけの状態」なのか「APIへ送るデータ」なのかを区別できます。

`api.ts`では、共通の`request<T>`をTodo操作別の関数が包んでいます。ここでは細かな`fetch`の書き方より、次の対応を押さえます。

| 画面の操作 | 関数 | HTTP |
| --- | --- | --- |
| 一覧取得 | `todoApi.list` | GET `/todos` |
| 作成 | `todoApi.create` | POST `/todos` |
| 更新 | `todoApi.update` | PATCH `/todos/{id}` |
| 削除 | `todoApi.remove` | DELETE `/todos/{id}` |

フロントとバックエンドの型は、`frontend/src/types.ts`と`src/shared/types.ts`に別々に定義されています。API境界を変更するときは、両方が一致しているか確認します。

### 3. `TodoComposer.vue`で「入力をイベントにする」流れを読む

`TodoComposer.vue`は、入力欄の値を`ref`で持ち、送信時に`CreateTodoInput`へ整形して、`create`イベントを発行します。APIは直接呼びません。

読むときは、同じ値を`<script setup>`と`<template>`で往復して追います。たとえば`title`なら、次の順です。

1. `const title = ref("")`で状態を作る
2. `v-model="title"`で入力欄と同期する
3. `submit()`で`title.value`を読む
4. `emit("create", ...)`で親へ渡す
5. 送信後に空文字へ戻す

この読み方を`dueDate`や`priority`にも適用すれば、フォーム全体を一行ずつ読む必要はありません。

### 4. `TodoWorkspace.vue`は機能ごとに分割して読む

`TodoWorkspace.vue`はこのフロントエンドで最も大きなファイルです。最初から最後まで一度に理解しようとせず、次のまとまりに分けます。

1. **元の状態**: `todos`、`filter`、`loading`などの`ref`
2. **表示用の派生値**: `openCount`、`availableTags`、`visibleTodos`などの`computed`
3. **API操作**: `loadTodos`、`createTodo`、`updateTodo`、`toggleTodo`
4. **ローカル更新の補助**: `replaceTodo`、`childrenFor`、`recalculateLocalParent`
5. **一時的なUI**: 削除・完了の取り消し、ドラッグ操作
6. **開始と終了**: `onMounted`、`onBeforeUnmount`
7. **テンプレート**: 上記の値と関数がどの要素へ結び付くか

まず1〜3とテンプレートだけを読み、ドラッグ処理は後回しにします。ポインター座標、DOM検索、スクロール制御が混ざるため、Vueのデータフローを理解する最初の題材には向きません。

### 5. 表示部品はpropsとemitの対応表を作って読む

`TodoItem.vue`と`StackedTodoItem.vue`では、親から受け取る値を`defineProps`、親へ伝える操作を`defineEmits`で宣言しています。

`TodoItem.vue`はAPIを呼ばず、たとえばチェックボタンを押すと`toggle`イベントを発行します。実際の更新は`TodoWorkspace.vue`が行います。つまり、責務は次のように分かれています。

```text
TodoItem:         何が操作されたかを伝える
TodoWorkspace:    状態をどう変え、どのAPIを呼ぶかを決める
api.ts:           HTTPリクエストへ変換する
```

`StackedTodoItem.vue`では、子の`TodoItem`が発行したイベントを`TodoWorkspace`へ中継する箇所があります。`@toggle="emit('toggle', $event)"`のような行を見つけ、イベントがどこまで上がるか追ってください。

## Todoを1件追加する流れを最後まで追う

最初に追う機能として、通常Todoの追加がおすすめです。

```text
TodoComposerの入力欄
  ↓ v-model
TodoComposer.submit()
  ↓ emit("create", input)
TodoWorkspaceの @create="createTodo"
  ↓
TodoWorkspace.createTodo(input)
  ↓
todoApi.create(token, input)
  ↓ POST /todos
APIから作成済みTodoが返る
  ↓
todos.value = [created, ...todos.value]
  ↓ computedが再計算され、一覧が再描画される
```

この流れでは、子が親の`todos`を直接変更していません。入力部品は「作成してほしい」と伝え、状態を所有する`TodoWorkspace`がAPIと一覧を更新します。

この流れを追えたら、次の順に別の操作へ広げます。

1. 完了切り替え: `TodoItem` → `toggleTodo` → `todoApi.update`
2. インライン編集: `TodoItem.save` → `updateTodo` → `todoApi.update`
3. タグ絞り込み: `selectedTag` → `visibleTodos` → テンプレート
4. 子Todo追加: `StackedTodoItem.addChild` → `createTodo`
5. 削除の取り消し: `scheduleDelete` → 5秒後の`commitDelete`

## このコードで押さえるVueの文法

### `ref`は元の状態、`computed`は状態から作る表示用の値

`todos`や`filter`はユーザー操作やAPI応答で変わるため`ref`です。`visibleTodos`や`openCount`は、それらから計算できるため`computed`です。

読みながら各変数へ「元の状態」か「派生値」かを書き添えると整理できます。派生値へ直接代入するのではなく、元になった`todos`や`filter`を変更すると表示が更新されます。

### propsは親から子、emitは子から親

このコードベースでは、データと操作依頼が逆方向に流れます。

```text
親 ── props ──> 子
親 <── emit ─── 子
```

テンプレートで`:todo="todo"`を見たら子の`defineProps`へ、`@toggle="toggleTodo"`を見たら子の`defineEmits`へ移動します。両側を一組として読むのがコツです。

### `v-model`には2種類ある

通常の入力要素では、`v-model="title"`が値の表示と入力イベントをまとめて扱います。

`MarkdownNoteField`のような独自コンポーネントでは、`modelValue`というpropsと`update:modelValue`というイベントの組み合わせが`v-model`になります。`TodoComposer.vue`の`v-model="note"`と、`MarkdownNoteField.vue`のprops・emitを並べて確認してください。

### `watch`は外から来た変化へ反応する

`TodoItem.vue`では、親から渡される`todo`が変わったとき、編集中のローカル値も更新するために`watch`を使います。`StackedTodoItem.vue`では、ドラッグ先になったとき自動で展開するために使います。

`computed`が「値を導く」ものなのに対し、`watch`は「変化をきっかけに別の処理を行う」ものとして読むと区別しやすくなります。

### ライフサイクルでは外部資源の開始と後片付けを対にする

`TodoWorkspace.vue`は`onMounted`で初回取得と60秒ごとの同期を始め、`onBeforeUnmount`でタイマーやイベントリスナーを解除します。`MarkdownNoteField.vue`もコピー表示用のタイマーを解除します。

`setInterval`、`setTimeout`、`addEventListener`を見つけたら、対応する解除処理があるか確認する習慣を付けます。

## テストは「期待される使い方」を知る仕様書として読む

各コンポーネントの隣にある`*.spec.ts`は、実装より短い利用例です。コンポーネントを読む前後に、同名のテストへ目を通してください。

テストでは、主に次の対応を見ます。

| テストの記述 | 意味 |
| --- | --- |
| `mount(Component, { props: ... })` | 親がどの値を渡すか |
| `wrapper.get(...).trigger(...)` | ユーザーが何を操作するか |
| `wrapper.emitted(...)` | 子が親へ何を伝えるか |
| `vi.mock(...)` | APIなどを本物と置き換えている箇所 |
| `expect(...)` | その機能が守るべき結果 |

最初に読むテストは、次の順がおすすめです。

1. `LoginView.spec.ts`
2. `TodoComposer.spec.ts`
3. `MarkdownNoteField.spec.ts`
4. `TodoItem.spec.ts`
5. `api.spec.ts`
6. `TodoWorkspace.spec.ts`
7. `StackedTodoItem.spec.ts`

`TodoWorkspace.spec.ts`ではAPIをモックし、画面の状態変化だけを検証しています。テストデータ、操作、期待結果の3点に分けて読むと理解しやすくなります。

## 手元で動かしながら読む

依存関係をまだ入れていない場合は、リポジトリ直下で次を実行します。

```bash
npm --prefix frontend install
```

開発サーバーは次のコマンドで起動します。

```bash
npm --prefix frontend run dev
```

開発時の`/todos`は、`frontend/vite.config.ts`のproxy設定によりデプロイ済みAPIへ転送されます。実際の画面へログインするにはCognitoのユーザーが必要です。認証情報がなくても、コンポーネントテストで画面の動作は確認できます。

```bash
# フロントエンドの全テスト
npm --prefix frontend test

# 1ファイルだけ実行
npm --prefix frontend test -- LoginView.spec.ts

# 型チェックと本番ビルド
npm --prefix frontend run build
```

コードを少し変えながら読む場合は、`npm --prefix frontend run test:watch`を起動しておくと、保存のたびに関連テストを再実行できます。

## 小さな変更で理解を確かめる

読むだけで分かった気になったら、影響の小さい変更を試します。変更前に関連テストを1本読み、変更後に同じテストを実行してください。

1. `LoginView.vue`の説明文を変える
2. `TodoComposer.vue`のプレースホルダーを変える
3. `emptyMessage`の文言を変え、どのfilterで表示されるか確認する
4. `parseTagInput`のテストケースを一つ追加する
5. `TodoItem`のイベントを検証するテストを一つ追加する

ドラッグ処理、認証、楽観的更新は影響範囲が広いため、上の練習を終えてから触るのが安全です。

## 読んでいて迷ったときの逆引き

| 知りたいこと | 最初に開く場所 |
| --- | --- |
| 最初にどの画面が出るか | `App.vue`のtemplate |
| Todo一覧の元データはどこか | `TodoWorkspace.vue`の`todos` |
| 表示対象がどう決まるか | `visibleTodos`と`groupedTodos` |
| ボタンを押した後に何が起きるか | templateの`@...`から同名関数へ移動 |
| APIへ何を送るか | `api.ts`と`api.spec.ts` |
| Todoの項目は何か | `types.ts` |
| 子Todoの親子関係は何か | `parentId`、`position`、`childrenFor` |
| 見た目はどこで決まるか | templateのclass名を`styles.css`で検索 |
| 正しい挙動は何か | 対応する`*.spec.ts` |
| アプリ全体の意図は何か | `docs/app.md` |

このガイドで解決しない疑問は、対象のtemplateからイベント名またはclass名を検索し、script、テスト、CSSの順に範囲を広げます。仕様か実装か判断できない場合は、`docs/app.md`の記述とテストの期待値を比較し、差分を調査メモとして残してください。

## 用語集

| 用語 | このコードでの意味 |
| --- | --- |
| SPA | ページ全体を再読み込みせず、Vueが表示を切り替えるアプリ |
| SFC | `<script>`と`<template>`などを一つにした`.vue`ファイル |
| Composition API | `ref`、`computed`、ライフサイクル関数などを使うVueの記述方法 |
| props | 親コンポーネントから子コンポーネントへ渡す値 |
| emit | 子コンポーネントから親コンポーネントへ通知するイベント |
| 派生値 | ほかの状態から計算できる値。このコードでは主に`computed`で表す |
| 楽観的更新 | API応答を待たず画面を先に更新し、失敗時だけ元へ戻す方法 |
| モック | テスト時にAPIなどの本物を予測可能な偽物へ置き換えること |
| Cognito IDトークン | 認証済みであることをAPIへ伝える短時間有効な文字列 |
