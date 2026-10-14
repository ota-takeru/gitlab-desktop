# GitLabコメント・レビュー操作の対応方針

2026-09-30。対象はSelf-ManagedのMRレビュー。以下の「モック」は架空データをメモリ内で操作する実装を指し、GitLabへの送信やサーバー下書き保存とは区別する。

## 基本操作

| 操作 | 今回のモック方針 | 実接続での条件 |
| --- | --- | --- |
| 通常コメント / スレッド開始 | 入力時に選ぶ。通常コメントには解決操作を表示しない | NotesとDiscussionsを区別 |
| 返信 | 対象スレッドに追加。通常コメントへの返信はスレッド化 | discussion IDを保持 |
| 行 / ファイルへのコメント | ファイル・旧/新側・行・SHA・比較範囲を保持 | base/start/head SHA、old/new path、差分位置をRust側で構築 |
| 自分のコメント編集・削除 | 本文編集、削除確認。親本文を削除しても既存返信を残す | サーバーの権限を確認。管理者権限を推測しない |
| 解決 / 再開 | スレッド単位。返信に伴う操作は公開時に実行 | resolvableと権限、最新状態を確認 |
| 今すぐコメント | メモリ内に即時追加 | 成否不明時の重複送信を防ぐ |
| レビューへ追加 | 未公開一覧へ追加。公開件数と解決状態は変えない | Draft Notes対応と取得・保存失敗の扱いを確認 |
| レビュー確認・公開 | 未公開本文の編集・削除、概要コメント、任意の承認 | 投稿と承認の部分成功を別管理 |
| レビュー破棄 | 確認後に選択MRの未公開分を削除 | サーバー下書きとローカル下書きの削除範囲を明示 |
| Markdown | 強調・コード・引用・リスト・表等の入力欄内での表示と本文表示 | GitLab固有構文、参照解決はサーバー仕様に合わせる |

絵文字リアクションは実装済み（MR本体と各コメント。追加は代表的な8種、既存チップで自分の分を付け外し）。REST Discussionsには含まれないため、コメント分は表示中の議論の最古コメントまでをGraphQL `MergeRequest.notes(filter: ONLY_COMMENTS)`の`awardEmoji`で100件ごとに1回取得し、MR本体はREST award_emojiで取得する。GraphQLのリアクションにはIDがないので、削除時はRESTの一覧から自分のリアクションIDを読み直す。[Emoji reactions API](https://docs.gitlab.com/api/emoji_reactions/)。

入力途中の本文とレビューへ追加済みの未公開コメントを分ける。MR、返信先、ファイル、SHA、旧/新側、行ごとに入力を区別し、別MRへ移動しても混ぜない。公開ダイアログに追加していない入力途中の本文を暗黙に送らない。

ショートカットはレビュー対応入力でCtrl+Enterをレビューへ追加、Ctrl+Shift+Enterを今すぐコメントに割り当てる。実通信のない状態をステータスとダイアログで明示する。

## 残る機能と接続時の判断

以下は同等性を目指す際の追加対象であり、今回の基本モックで対応済みとはしない。

- 添付アップロード、画像貼り付け、ユーザー/グループメンション候補、GitLab参照リンクの解決。
- 古い差分位置の追跡、システムイベントのフィルター。

実接続では、複数行選択（`position[line_range]`）とSuggestionの作成・表示・適用を実装済み。行コードはGitLabの形式（`<ファイルパスのSHA-1>_<旧行位置>_<新行位置>`）でRust側が計算し、範囲が同じハンク内で終端がコメント行であることも送信前に検証する。Suggestionの適用はREST notesの`suggestions`にあるIDで`PUT /suggestions/:id/apply`（複数は`PUT /suggestions/batch_apply`）を使い、表示時のMR head SHAが変わっていないことを確認してから一度だけ送る。IDのないコメントはGitLabで開いて適用する。
- GitLab固有Markdown・quick actions。入力欄での表示は基本Markdownの範囲とし、コマンドを実行したかのような表示にしない。
- スレッドロック、管理権限による他人の編集。接続先の版・tier・権限で利用可否を判定する。

Request changesとレビュー再依頼は実装済み。どちらもREST APIに対応する操作がなく、GraphQLの`mergeRequestRequestChanges`（GitLab 18.9で追加）と`mergeRequestReviewerRereview`を使う。Request changesは現在のユーザーがレビュアーである場合だけ受け付けられる。接続先のスキーマにない、または`errors`が返った場合は適用されなかったものとして`UNSUPPORTED`を表示し、結果を読み取れない応答は結果不明として再送を止める。送信前にMRの`references.full`がActionのプロジェクトパスと一致すること、再依頼では相手がまだレビュアーであることを確認する。

モックの短いSHAや単一pathは表示確認用の簡略モデルであり、Discussions APIへそのまま送れるリクエスト型ではない。承認ボタンが下書きを自動公開する挙動はGitLabの版に差があるため、接続先を確認するまで承認と公開を分ける。

Markdownは生HTMLを挿入せず、実行可能URLをリンク化しない。未接続モックは画像URLを自動取得しない。投稿内容のネットワーク処理・資格情報・永続キャッシュは既存のRust境界に従う。

## 参照資料

- [Comments and threads](https://docs.gitlab.com/user/discussions/): 通常コメント、スレッド、差分コメント、編集など。
- [Merge request reviews](https://docs.gitlab.com/user/project/merge_requests/reviews/): 即時コメント、未公開レビュー、返信に伴う解決/再開、公開と破棄。
- [Discussions API](https://docs.gitlab.com/api/discussions/): 複数行コメントの`line_range`と行コードの形式。
- [Suggest changes](https://docs.gitlab.com/user/project/merge_requests/reviews/suggestions/)と[Suggestions API](https://docs.gitlab.com/api/suggestions/): `suggestion:-N+M`の記法と適用API。提案IDはAPIドキュメントに取得方法の記載がなく、REST notesの`suggestions`（[Note entity](https://gitlab.com/gitlab-org/gitlab/-/blob/master/lib/api/entities/note.rb)、MRの差分コメントだけに付く）から得る。
- [Discussions API](https://docs.gitlab.com/api/discussions/): スレッド、返信、行位置とSHA。
- [Draft Notes API](https://docs.gitlab.com/api/draft_notes/): 未公開コメントと公開操作。
- [GraphQL API reference](https://docs.gitlab.com/api/graphql/reference/): `mergeRequestRequestChanges`、`mergeRequestReviewerRereview`。
