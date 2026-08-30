# あとで読む機能はLINEとKotlin共有を入口にし、Webで整理する

作成日: 2026-08-23

## この文書で決めること

Todoアプリへ、Raindrop.ioのように記事リンクをためて後から整理する機能を追加する。リンクの主な登録元はLINEとAndroidのKotlinアプリとし、Web版は閲覧・整理の中心にする。

本書は実装前の設計案である。Bookmarkのデータ構造、登録経路、API、メタデータ取得、安全対策までを対象にする。ブラウザ拡張、記事本文の保存、AI要約、複数ユーザー対応は今回の対象外とする。

## 使い方

### LINEから登録する

LINEへURLを含むメッセージを送ると、メッセージ内のURLをすべて抽出し、Bookmarkの`inbox`へ保存する。URLがないメッセージは、これまでどおりTodoとして保存する。

たとえば、次のメッセージには2件のBookmarkを作成する。

```text
週末に読む
https://example.com/article-1
https://example.com/article-2
```

URL以外の「週末に読む」は、2件に共通するメモとして保存する。1メッセージから登録できるURLは最大20件とし、上限を超えた分は処理しない。LINEへの返信はMVPでは行わず、処理結果はCloudWatch Logsで確認する。

### Kotlinアプリから共有する

Androidの共有先にKotlinアプリを表示し、ブラウザやニュースアプリから1件または複数件のリンクを受け取る。受信対象は`ACTION_SEND`、`ACTION_SEND_MULTIPLE`、`EXTRA_TEXT`、`ClipData`とする。

共有元によっては、複数URLが1つのテキストへ改行区切りで格納される。そのため、Intentの件数だけで判断せず、受け取ったすべてのテキストからURLを抽出する。

共有画面では、登録前に次の項目をまとめて指定できるようにする。

- タグ
- メモ
- 初期状態。既定値は`inbox`

通信に失敗した場合はWorkManagerへ登録し、ネットワーク復旧後に再送する。同じ共有操作が再送されてもBookmarkが重複しないよう、BE側でURLを正規化して重複を判定する。

### Web版で整理する

現在のTodo画面に「Todo」と「あとで読む」の切り替えを追加する。あとで読む画面では、次の操作を提供する。

- URL、タイトル、サイト名、メモの表示
- タグの追加・削除・タグ別絞り込み
- `inbox`、`reading`、`read`、`archive`の状態変更
- お気に入りの切り替え
- タイトル、URL、メモの編集
- Bookmarkの削除
- キーワード検索

登録直後はURLだけでも一覧に表示する。タイトルや画像の取得を待たずに保存を完了させ、取得後に表示を更新する。

## TodoとBookmarkは別テーブルで管理する

TodoとBookmarkでは、必要な属性と整理方法が異なる。既存の`Todos`テーブルへ混在させず、新しく`Bookmarks`テーブルを作る。

```ts
interface Bookmark {
  id: string;
  url: string;
  normalizedUrl: string;
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  status: "inbox" | "reading" | "read" | "archive";
  tags: string[];
  memo?: string;
  favorite: boolean;
  source: "line" | "android" | "web";
  metadataStatus: "pending" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
}
```

`id`には正規化URLのSHA-256ハッシュを使用する。単一ユーザーのMVPでは、同じURLを再登録した場合に新しいレコードを作らず、既存Bookmarkの`updatedAt`を更新する。再登録時に渡されたタグは既存タグへ追加し、状態は明示指定がない限り変更しない。

URLの正規化では、スキームとホスト名を小文字化し、フラグメントを削除し、既定ポートを除去する。クエリ文字列は記事を識別する可能性があるためMVPでは保持する。広告計測用パラメータの除去は、対象サイトによる差が大きいため実装後に検討する。

## 一括登録APIで入力元をそろえる

LINEとKotlinアプリは、同じ一括登録処理を利用する。外部公開するAPIはCognito認証が必要だが、LINE WebhookはLINE署名検証後に内部の共通関数を呼ぶ。

### 一括登録

```http
POST /bookmarks/batch
Authorization: <Cognito ID token>
Content-Type: application/json
```

```json
{
  "items": [
    { "url": "https://example.com/article-1" },
    { "url": "https://example.com/article-2" }
  ],
  "tags": ["技術", "週末"],
  "memo": "週末に読む",
  "status": "inbox"
}
```

1リクエストは最大20件とする。APIはURLを検証してBookmarkを保存し、各項目の受付結果を返す。

```json
{
  "results": [
    { "url": "https://example.com/article-1", "status": "created", "id": "..." },
    { "url": "https://example.com/article-2", "status": "existing", "id": "..." }
  ]
}
```

一部のURLだけが不正な場合も、リクエスト全体を失敗させない。結果は`created`、`existing`、`invalid`のいずれかで返す。

### CRUD

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/bookmarks` | 一覧取得 |
| `POST` | `/bookmarks/batch` | 1件または複数件の登録 |
| `PATCH` | `/bookmarks/{id}` | タイトル、状態、タグ、メモ、お気に入りの更新 |
| `DELETE` | `/bookmarks/{id}` | 削除 |

一覧のタグ・状態・検索条件は、MVPではフロント側で適用する。個人用途で件数が少ない間はDynamoDBの`Scan`で足りる。件数や待ち時間が増えた段階で、ページネーションとインデックスを追加する。

## メタデータは保存後に取得する

複数URLのタイトルやOG画像をAPI内で順番に取得すると、LINE WebhookとAndroid共有画面の応答が遅くなる。登録APIではBookmarkを`metadataStatus: "pending"`で保存し、SQSへ取得ジョブを送る。別のLambdaがページを取得し、タイトル、説明、サイト名、OG画像URLを補完する。

取得の優先順位は次のとおりとする。

1. タイトル: `og:title`、`<title>`、URLの順
2. 説明: `og:description`、`meta[name="description"]`の順
3. サイト名: `og:site_name`、ホスト名の順
4. 画像: `og:image`がある場合のみ

取得に失敗してもBookmark自体は残し、`metadataStatus: "failed"`へ変更する。Web版から再取得を実行できるようにするかは、MVPの利用状況を見て判断する。

## 外部ページの取得には制限を設ける

Lambdaが任意のURLへアクセスできる設計は、内部ネットワークへの不正アクセスに悪用されるおそれがある。メタデータ取得処理には次の制限を設ける。

- `http`と`https`以外のスキームを拒否
- `localhost`、プライベートIP、リンクローカルIP、AWSメタデータエンドポイントを拒否
- DNS解決後のIPも検証し、リダイレクト先でも同じ検証を繰り返す
- リダイレクト回数、応答時間、取得サイズを制限
- HTML以外の大容量レスポンスを読み込まない
- URL、タグ、メモの長さと件数をAPIで検証

OG画像はMVPでは外部URLを保存するだけにする。外部画像をWebで直接表示すると閲覧先へアクセス元が伝わるため、画像のS3キャッシュや画像を表示しない設定は実装時に改めて決める。

## Android用Cognitoクライアントを分ける

Kotlinアプリには固定APIキーやAWSアクセスキーを持たせない。現在のUser PoolへAndroid専用のUser Pool Clientを追加し、ログイン後に得たIDトークンを`Authorization`ヘッダーへ付ける。

WebとAndroidでクライアントを分けると、一方だけを無効化でき、利用状況も切り分けやすい。どちらもクライアントシークレットは発行しない。Android側のトークン保存と更新には、Cognito対応SDKを利用する。

## AWS構成の追加範囲

既存の`TodoAppStack`へ次を追加する想定とする。

- DynamoDB `Bookmarks`テーブル
- Bookmark CRUD用Lambda
- SQSメタデータ取得キューとデッドレターキュー
- メタデータ取得用Lambda
- API Gatewayの`/bookmarks`ルート
- Android用Cognito User Pool Client

LINE Webhook URL、既存の`Todos`テーブル、Todo CRUD APIは変更しない。LINE Webhook Lambdaには、メッセージ内のURL有無でTodoとBookmarkを振り分ける処理を追加する。

## MVPで確認すること

- LINEの通常テキストが引き続きTodoになる
- LINEの単一URLと複数URLがBookmarkになる
- URL以外の文章が共通メモとして保存される
- Androidの単一共有と複数共有を受信できる
- オフライン時の共有がWorkManagerから再送される
- 同じURLを再送しても重複しない
- 登録直後にURLがWeb一覧へ表示される
- メタデータ取得後にタイトルなどが更新される
- Webで状態、タグ、メモ、お気に入りを変更できる
- CognitoトークンがないBookmark API呼び出しを拒否する
- 内部IPや不正なスキームをメタデータ取得処理が拒否する

## 実装前に残っている判断

現時点では、次の方針を推奨する。

| 論点 | 推奨案 | 理由 |
|---|---|---|
| OG画像 | URLのみ保存し、初期設定では表示する | 実装が軽い。ただしプライバシーが気になる場合は非表示に切り替える |
| URL正規化 | クエリを保持する | 意味のあるクエリまで消す事故を避ける |
| 再登録 | 既存Bookmarkを更新する | LINEやWorkManagerの再送で重複しない |
| メタデータ取得 | SQSを使って非同期化する | 複数共有でも入力元を待たせない |
| Android認証 | Webとは別のCognitoクライアントを使う | 影響範囲を分離できる |

未解決なのは、OG画像を外部から直接読み込むか、S3へキャッシュするかである。MVPでは直接表示から始められるが、閲覧先への通信を避けたい場合は画像非表示かS3キャッシュへ変更する。この点は実装着手時に決める。
