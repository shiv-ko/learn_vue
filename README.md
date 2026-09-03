# todo_learn_vue

Vue,awsあたりを学びながら、普段のTodoと「あとで読みたいもの」をまとめるために作っているplayground兼個人で使う用のtodoアプリです。

## 今できること

- 通常のTodoと、子Todoを積み上げるStacked Todoの管理
- 期限、優先度、タグ、メモ、学習ノートの記録
- LINEからテキストを送ってTodoを追加
- LINEからURLを送って「あとで読む」へ追加
- Bookmarkの検索、状態管理、お気に入り、編集
- Cognito認証とAWS上でのデータ共有
- AndroidからBookmarkを一括登録するためのバックエンドAPI

## これからやりたいこと

完成品を一度に作るより、興味のある技術を小さく試しながら育てています。

- Amazon Bedrockを使い、TodoやBookmarkへ自動でタグを付ける
- LINEからTodoや「読みたいもの」を取得し、完了や既読も操作できるようにする
- ポモドーロと作業ログを追加する
- MCP経由でAIからTodoを確認・更新する
- パスキー認証を試す
- KotlinのAndroidアプリから共有されたURLを登録する

フロントはVue 3とTypeScript、バックエンドはAPI Gateway、Lambda、DynamoDB、Cognitoを使い、AWS CDKで管理しています。
