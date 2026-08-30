# 個人用Todoアプリ（MVP） 設計

作成日: 2026-08-09

## 背景・きっかけ

現在、細かいtodo（お盆中にやりたいことなど）の管理先が定まっていなかった。既存のGitHub Issues運用（`/quick-note`, `/triage`）は「book/idea/watch」のような比較的大きめの塊を振り分けるのには向いているが、日々の細かいtodoを都度Issue化すると一覧のノイズになり管理コストが上がる。

PC2台・スマホをまたいでこまめに更新したい、かつLINEからメッセージを送るだけでtodoを追加したい、という要望から、専用の個人用Todoアプリを新規に作ることにした。将来的には現行のGitHub Issues運用（カテゴリラベル・ステータスラベルによる管理）を完全に置き換えることも視野に入れているが、一気に作るとリスクが高いため、今回はコア機能のみのMVPを設計する。

**既存のLINE Botとの関係**: `infra/line-worker`（Cloudflare Worker）が既にLINEメッセージを`03_journal`/`06_thoughts/inbox`へ保存する用途で稼働している。LINEチャンネルのWebhook URLは1つしか設定できず既存Workerと競合するため、本アプリでは**Todo専用の新しいLINE公式アカウント/チャンネル**を作成し、そのWebhookを直接AWS Lambdaに向ける（既存Workerの改修は行わない）。

## スコープ

**MVPに含む**:

- Todoの作成・一覧・完了・編集・削除
  - 属性: title, done, 期限（dueDate）, 優先度（priority）, メモ（memo）、学習ノート（note）、タグ（tags）
- Cognitoによる単一ユーザー認証（管理者が作成したユーザーのみログイン可能）
- PC2台・スマホでの同期（同一DBを参照するのでデバイス間の同期は自然に実現される）
- LINEメッセージ送信 → 新規todo自動追加（一方向のみ。LINE上での一覧表示・完了操作は行わない）

**MVPに含まない（将来フェーズで検討）**:

- ステータスラベル（inbox/next/someday/waiting等）と `/triage` 相当の振り分けフロー
- LINE経由での一覧表示・完了操作（双方向化）
- GitHub Issues運用からの本格移行・データ移管

## アーキテクチャ

```
┌─────────────┐       ┌──────────────────┐
│  Vue3 SPA   │──────▶│ CloudFront + S3   │ (静的ホスティング)
│ (PC×2/スマホ) │       └──────────────────┘
└──────┬──────┘
       │ HTTPS (Cognito IDトークン)
       ▼
┌──────────────────┐
│  API Gateway      │
└──────┬────────────┘
       │
       ├──▶ Lambda: todos-api (CRUD)  ──┐
       │                                 ▼
       │                          ┌─────────────┐
       │                          │  DynamoDB   │
       │                          │  (Todos)    │
       │                          └─────────────┘
       │                                 ▲
       └──▶ Lambda: line-webhook ────────┘
                  ▲
                  │ Webhook (署名検証)
           ┌──────────────┐
           │ LINE Platform │
           └──────────────┘
```

**構成要素**:

- **フロント**: Vue3（TypeScript）のSPA。S3に静的ファイルを配置し、CloudFrontで配信。
- **API層**: API Gateway（REST API）+ Lambda（TypeScript/Node.js）2本
  - `todos-api`: CRUD用。Cognito User PoolのIDトークンをAPI Gateway Authorizerで検証する。
  - `line-webhook`: LINEからのWebhook受信専用。LINE Messaging APIの署名検証（`X-Line-Signature`ヘッダー）で認証。Cognitoとは別軸の認証。
- **認証**: Cognito User Pool。自己登録は無効、SPA用クライアントにはクライアントシークレットを発行しない。
- **DB**: DynamoDB（単一テーブル、単一ユーザー前提のシンプルな構造）
- **インフラ管理**: AWS CDK（TypeScript）、単一Stack（`TodoAppStack`）

フロントは直接DynamoDBに触らず、ログイン後に取得した短時間有効なIDトークンを`Authorization`ヘッダーへ付けてAPI Gatewayを呼び出す。固定APIキーなどの長期シークレットはフロントへ埋め込まない。

### 検討した代替案

- **フロントからDynamoDB/Tursoに直接アクセス**: 構成はシンプルになるが、LINE Webhookの受け口が別途必要になる点は変わらず、かつクレデンシャルをフロントに持たせる範囲が広がる。今回はLambdaを「アプリ全体のAPIレイヤー」として明示的に使いたいという希望があったため採用しなかった。
- **Turso（SQLite互換）**: フロントが直接DBに触る前提であれば有力だったが、Lambda経由のAPI構成にしたことで「AWS内で完結する」メリットの方が大きく、DynamoDBを採用。
- **Notion DBをバックエンドにする**: Notion API経由でpageをCRUDし、LINE WebhookからNotionに直接書き込む構成も可能。Notion公式アプリがそのままモバイル/PCの閲覧・編集UIになるため自作フロントが不要になる利点があるが、今回は独自のVue3フロントを持ちたい（Notionの画面をそのままUIにはしたくない）という意向のため採用しなかった。API レート制限（3req/秒程度）やレイテンシの面でもDynamoDBに劣る。
- **IaC: AWS SAM / Serverless Framework**: SAMはシンプルだがコードでの柔軟性に欠ける。Serverless FrameworkはAWS外への対応が魅力だが、v4以降のライセンス形態が個人利用には過剰。CDK（TypeScript）はフロントと言語を統一でき、今後の機能拡張（フェーズ2）にも対応しやすいため採用。

## データモデル（DynamoDB）

テーブル: `Todos`（単一テーブル、単一ユーザー前提）

| 属性        | 型                                        | 説明                                                   |
| ----------- | ----------------------------------------- | ------------------------------------------------------ |
| `id`（PK）  | String (UUID)                             | Todo ID                                                |
| `title`     | String                                    | 内容（LINE経由の場合はメッセージ本文がそのまま入る）   |
| `done`      | Boolean                                   | 完了フラグ                                             |
| `dueDate`   | String（ISO date, optional）              | 期限                                                   |
| `priority`  | String（`high`/`medium`/`low`, optional） | 優先度                                                 |
| `memo`      | String（optional）                        | 詳細メモ                                               |
| `note`      | String（Markdown, optional）              | 学びたい内容を記録する長文ノート。最大20,000文字       |
| `tags`      | String[]（optional）                      | 自由入力タグ。LINE経由では`inbox`を自動付与            |
| `kind`      | String（`standard`/`stacked`, optional）  | Todoの種類。既存データの未設定は`standard`として扱う   |
| `parentId`  | String（optional）                        | 子Todoが属するStacked TodoのID。親と通常Todoでは未設定 |
| `position`  | Number（optional）                        | 同じ親の中での子Todoの0始まりの表示順                  |
| `createdAt` | String（ISO datetime）                    | 作成日時                                               |
| `updatedAt` | String（ISO datetime）                    | 更新日時                                               |

**アクセスパターン**:

- 一覧取得: `Scan`（個人用途で件数が少ないため、GSIなしのScanで十分。件数が増えたら`done`用のGSIを検討）
- 単体の作成・更新・削除: `PutItem` / `UpdateItem` / `DeleteItem`（`id`で直接指定）
- 親子の組み立て: 一覧の`Scan`結果を`parentId`でグループ化する。個人用途の規模を前提に、親子専用GSIは設けない
- 子の追加・移動・削除: 対象親の子を`position`順に並べ直し、0始まりの連番へ正規化する
- 親の完了判定: 子の更新後に同じ親の子を再取得し、1件以上ある子がすべて完了なら親を完了、1件でも未完了なら親を未完了にする

Stacked Todoは1段だけとし、子Todoを別の子Todoの親にすることはできない。通常TodoからStacked Todoへの変換ではレコードをそのまま親として使う。Stacked Todoから通常Todoへ変換すると、既存の子Todoは削除せず、`parentId`と`position`を外して独立した通常Todoへ戻す。Stacked Todoの削除時も同様に子Todoを独立させる。

LINE経由で作成されたtodoは `title` = メッセージ本文、`tags` = `["inbox"]`、それ以外はデフォルト値（`done: false`、期限・優先度・メモは空）で作成する。

## API設計

| Method | Path            | 用途                     | 認証               |
| ------ | --------------- | ------------------------ | ------------------ |
| GET    | `/todos`        | 一覧取得                 | Cognito IDトークン |
| POST   | `/todos`        | 新規作成                 | Cognito IDトークン |
| PATCH  | `/todos/{id}`   | 更新（完了切替・編集）   | Cognito IDトークン |
| DELETE | `/todos/{id}`   | 削除                     | Cognito IDトークン |
| POST   | `/line/webhook` | LINEからのメッセージ受信 | LINE署名検証       |

**リクエスト例**:

- `POST /todos` body: `{ "title": "...", "dueDate"?: "...", "priority"?: "...", "memo"?: "...", "note"?: "...", "tags"?: string[], "kind"?: "standard" | "stacked", "parentId"?: string, "position"?: number }`
- `PATCH /todos/{id}` body: 更新したいフィールドのみ（例: `{ "done": true }`、子の移動は`{ "parentId": "...", "position": 0 }`）

子Todoを持つStacked Todoの`done`は直接変更できず、子Todoの状態から自動更新する。子Todoに`kind: "stacked"`を指定する、Stacked Todoを子にする、自分自身を親にする、といった不正な構造変更は400で拒否する。

**LINE Webhookのフロー**:

1. LINE Platformがユーザーのメッセージ送信をWebhookでPOST
2. `line-webhook` Lambdaが署名検証 → イベントからテキストメッセージを抽出
3. `title = メッセージ本文` でDynamoDBに新規Item作成（`todos-api`と共通のロジックを共有関数として切り出す）
4. LINEへの返信は行わない（一方向のため）

## エラーハンドリング

- **API層（todos-api）**: バリデーションエラー（title必須など）は400、存在しないidへのPATCH/DELETEは404、その他は500。フロントはエラー時にトースト通知程度の簡易表示。
- **認証**: IDトークンがない、期限切れ、または不正なリクエストはAPI Gatewayが401で拒否する。
- **LINE Webhook**: 署名検証に失敗したリクエストは401で即座に拒否。テキスト以外のメッセージ（スタンプ・画像等）は無視し、LINE Platformへは200を返す（再送を防ぐため、処理失敗時も基本200を返しログに記録する方針）。
- **DynamoDB書き込み失敗**: SDKデフォルトのリトライ任せ。個人用途のため複雑なリトライ戦略は組まない。
- **フロント側の同期**: WebSocket等は組まず、一覧取得は画面表示時 + 一定間隔のポーリング、または手動リフレッシュ。複数デバイス間の同時編集の競合は想定せず、Last-Write-Winsで割り切る。

## テスト戦略

- **Lambda（todos-api / line-webhook）**: Vitestでユニットテスト。DynamoDBは`aws-sdk-client-mock`等でモックし、ハンドラのロジック（バリデーション、レスポンス整形、署名検証）を検証する。
- **Vue3フロント**: Vitest + Vue Test Utilsでコンポーネント単体テスト（一覧表示、完了トグル等の主要導線のみ）。
- **CDKスタック**: `aws-cdk-lib/assertions`でCognito User Pool・SPA用クライアント・Authorizerと、CRUDメソッドへの認証設定を検証する。
- **E2E**: MVPでは組まない。デプロイ後に手動で一通り確認する。

## デプロイ構成（CDK）

単一CDK Stack（`TodoAppStack`）にまとめる（個人用・単一環境のため環境分割は不要）。

- `DynamoDB Table`（Todos）
- `Lambda: todos-api` + `Lambda: line-webhook`
- `API Gateway`（REST API、Cognito User Pools Authorizer）
- `Cognito User Pool`（自己登録無効）+ SPA用User Pool Client（クライアントシークレットなし）
- `S3 Bucket`（フロント静的ファイル） + `CloudFront Distribution`
- **Secrets管理**: LINE Channel Secret / Access TokenはSSM Parameter Storeで管理する。User Pool IDとClient IDは公開識別子であり、フロント設定に含めてよい。

**デプロイフロー**: `cdk deploy`でバックエンド一式をデプロイ。フロントのビルド成果物（`dist/`）はCDKの`BucketDeployment`でS3への配置まで自動化する。

### フロントエンド実装

`frontend/` にVue 3 + TypeScriptのSPAを配置する。主な機能は以下。

- Cognitoのメールアドレス・パスワードによるSRPログイン
- Todoの一覧、追加、完了切替、インライン編集。削除は「完了」一覧の完了Todoだけに限定し、削除後は取り消せる
- Todoを完了にした直後は5秒間「元に戻す」を表示する。完了一覧のチェック操作からも未完了へ戻せる
- 自由入力タグ（10個まで）の追加・編集・タグ別絞り込み
- Todo作成時に「理解したいこと」をMarkdownで任意入力できる。学習ノートは一覧に表示せず、Todoの詳細編集で確認・修正・コピーできる
- 作成時に「通常」と「Stacked」を選択できる。既存Todoも編集画面から相互変換できる
- Stacked Todoは一覧では通常閉じて表示し、トグルを開くと進捗、子Todo、追加欄を表示する。子Todoは個別に完了・編集・削除できる
- 通常TodoをドラッグしてStacked Todoへドロップすると、その親の末尾へ子Todoとして追加できる。子Todoは上下ボタンで並び替え、移動先から別のStacked Todoまたは「通常Todoに戻す」を選べる。入れ子は1段に制限する
- 子Todoをすべて完了すると親も自動完了し、子Todoを未完了へ戻すと親も自動で未完了へ戻る
- 「未完了」「すべて」は優先度（高・中・小・未設定）ごとの縦レーン表示。高から順に並び、各Todo内では重複する優先度ラベルを表示しない。マウス・タッチのドラッグまたはドラッグハンドルへのフォーカス中の上下キーでレーン間を移動できる
- 「完了」は優先度レーンを使わない通常一覧とし、各Todo内に優先度を表示する。優先度の移動操作は表示しない
- 優先度変更は画面へ即時反映し、保存に失敗した場合は元のレーンへ戻してエラーを表示する。`PATCH /todos/{id}`へ`{ "priority": null }`を送ると優先度を解除できる
- 未完了・すべて・完了の絞り込み
- 60秒ごとの自動同期と手動再読み込み
- 320px幅から利用できるレスポンシブUI

User Pool IDとUser Pool Client IDは公開識別子としてフロントに含める。固定APIキーやAWSのアクセスキーは含めず、API呼び出しにはCognitoが発行する短時間有効なIDトークンだけを使用する。CloudFrontが同一オリジンの`/todos`と`/todos/*`をAPI Gatewayへ転送する。

### セットアップとデプロイ

```bash
cd infra/todo-app-backend
npm install
npm --prefix frontend install
npm test
npm run synth
npm run deploy -- --require-approval never
```

デプロイ完了後、CloudFormation Outputの`AppUrl`がアプリのURLになる。既存のLINE Webhook URLは変更せず、API Gatewayの`/prod/line/webhook`を引き続き利用する。

## 今後の拡張（フェーズ2以降・今回のスコープ外）

- カテゴリラベル・ステータスラベルの導入（GitHub Issues運用の再現）
- `/quick-note` `/triage` 相当のフローをアプリ内に実装
- LINE双方向化（一覧表示・完了操作をLINE上で）
- GitHub Issuesからのデータ移行、既存運用の廃止
