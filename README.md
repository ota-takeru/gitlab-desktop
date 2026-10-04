# GitLab Desktop

Windows向けの個人用GitLab APIクライアントです。Tauri 2 / Rust / React / TypeScript / MUIを使用し、GitLab.comとSelf-ManagedへRustから直接接続します。通常の接続・通信はglabやGitLabサイトの埋め込みに依存しません。

ソースと配布物: [GitHub](https://github.com/ota-takeru/gitlab-desktop) / [Releases](https://github.com/ota-takeru/gitlab-desktop/releases)。

## 使い方と実装範囲

現在の検証対象はGitLab.comです。[製品品質の検証状況](docs/product-readiness.md)に、確認済みの内容と認証・実機操作に関する未確認項目をまとめています。

ReleasesのWindows NSISインストーラーから起動し、「接続設定」で `https://gitlab.com` または社内GitLabのHTTPS URLとPersonal Access Tokenを入力します。サブパス付きURLに対応しています。従来型PATの読み取りには `read_api`、レビュー投稿には `api` scopeが必要です。トークンはWindows資格情報ストアへ保存し、読出しで画面へ返しません。

glabで対象GitLabへログイン済みなら、接続画面の「glabの認証情報で接続」を明示的に選んでPAT入力を省略できます。この操作ではRustが接続URLのauthorityと一致する`glab`保存済み認証だけを一度読み取り、PATまたはOAuthアクセストークンを接続確認と`/user`確認の後にWindows資格情報ストアへコピーします。OAuthの期限は未来のRFC3339値だけを受け付け、refresh tokenは取り込みません。glabのログイン・refreshやグローバル設定変更は行わず、取り込み後のGitLab API通信はすべてRustから直接行います。手動PAT接続も引き続き利用できます。

- プロジェクト検索、参加中／閲覧可能・アーカイブ条件、固定・最近使った項目。
- 現在／過去のMRのタイトル・説明検索、状態・プロジェクト・レビュー担当等の条件、ページング。
- MR概要、議論、差分、コミット別差分、指定SHAのファイル本文。
- コメント、MR全体差分の行・ファイルコメント、返信、自分のコメント編集・削除、解決・再開。
- サーバー下書きの保存・編集・削除・選択公開、承認・承認取消。未対応APIや権限不足はエラーとして表示。
- 接続先・ユーザー別SQLiteキャッシュ。保存済みを先に表示して更新し、古さ・失敗を明示。保持上限は30日／キャッシュ予算128MiB、DB全体256MiB。ログアウトで保存データと資格情報を削除。
- 未送信コメントを端末に保存し、再起動・認証切れ・画面復旧後に復元。GitLabのサーバー下書きとは別に扱い、アカウントごとに100件、本文64KiBまで保持します。通常の終了と更新前には保存待ちを完了し、保存失敗を明示します。
- 結果未確認の投稿記録を永続化し、再起動後も同じMRへの再送を停止。投稿中は切断・接続切替を拒否します。ログアウトは未送信入力と確認記録も削除するため確認を表示します。
- 差分600行、ファイル本文1000行、議論20件、議論内コメント50件ごとに表示を区切り、前後移動で取得済みデータをすべて閲覧できます。
- 署名付きNSIS配布と自動更新。起動時と表示中の6時間ごとに確認し、未保存入力や送信処理がなく2分間操作がないときに自動インストール・再起動。「後で」で延期可能。

投稿は自動再送しません。結果不明時はGitLab上で確認するまで再送を止めます。公開と承認は別操作で、選択していないWeb側下書きを一括公開しません。コミット別閲覧とMR全体のコメント位置は区別します。

証明書検証は常に有効です。社内CAはWindowsの信頼ストア、通信は環境のプロキシ設定を使用します。アプリ自身のOAuthログイン・自動refresh、PAC、NTLM、mTLSは現時点の対応対象に含めません。明示的なglab取り込みでのOAuthアクセストークン利用とは区別してください。Issue、Pipeline、マージ、Suggestion適用、添付、ローカル全文検索、複数接続の同時表示は後続の設計です。Self-Managed実機との互換性と認証付き実投稿は接続後に確認する必要があります。詳細は[全体設計](docs/architecture.md)を参照してください。

## 開発環境

確認した環境: Windows x64、Node.js 24.16.0、npm 11.13.0、Rust 1.98.0、Visual Studio 2022のC++ツール、Windows SDK、WebView2 Runtime。

Rustはルートの`rust-toolchain.toml`でプロジェクト単位に固定しています。既定のRustが古くても、このフォルダーでは指定バージョンを使用します。Nodeのバージョンは`.node-version`を参照してください。初回は依存のダウンロードとRustのコンパイルに時間がかかります。

```powershell
npm ci
npm run desktop:dev
```

デスクトップウィンドウが開きます。終了時はウィンドウを閉じ、開発ターミナルで必要に応じてCtrl+Cを押します。

ブラウザーでUIだけを確認する場合:

```powershell
npm run dev
```

[ローカルプレビュー](http://localhost:1420)。このモードではRustの情報を取得できません。

UI方針を検討する操作モックは[UIモック](http://localhost:1420/#mock)から開きます。レビュー一覧・差分・議論、プロジェクト探索、過去MR検索、明暗テーマを確認できます。常時「UIモック / サンプルデータ / 未接続」と表示し、コメントや承認はメモリ内のシミュレーションです。リロードすると操作内容は消えます。実際のAPI接続・キャッシュ保存とは別のプレビューです。

以下の操作説明は `#mock` のサンプル画面に関するものです。実接続画面の対応範囲は冒頭の機能一覧を参照してください。

プロジェクト一覧から専用画面を開き、プロジェクト内の現在/過去のMRを検索できます。MRの「変更」ではタイムラインからMR全体または各コミットを選び、「差分 / ファイル全体」で選択した版の変更内容と全文を切り替えます。MRを開くと左端の「議論」を表示し、コメントと返信を中心に確認できます。「概要」は説明文や付帯情報を必要なときに見る参照画面です。

コメントは通常コメント、解決可能なスレッド、返信、行・ファイルへのコメントを操作できます。Markdownプレビュー、自分の投稿の編集・削除、議論の解決・再開に対応しています。「レビューを開始 / 追加」で未公開コメントをため、確認画面で編集・破棄・一括公開・任意の承認を試せます。Ctrl+Enterはレビューへ追加、Ctrl+Shift+Enterは即時コメントです。添付・Suggestionなどの未対応項目と実接続時の条件は[コメント・レビュー対応方針](docs/comment-review-parity.md)を参照してください。

## チェックとビルド

```powershell
npm run check
npm run desktop:build -- --no-bundle
```

`check`はlint、動作・リリーススクリプトのテスト、デザイン制約、TypeScript、フロントエンドビルド、Rustのfmt / clippy / testを実行します。GitLab.com公開APIの実通信テストは `cargo test --manifest-path src-tauri/Cargo.toml --locked gitlab_com_public_projects -- --ignored` で明示して実行します。

release実行ファイル: `src-tauri/target/release/gitlab-desktop.exe`。配布は公開鍵を埋め込んだNSISインストーラーを使用します。更新署名鍵はGitHub Repository secretに保存し、ソースには含めません。Tauriの更新署名はWindowsのAuthenticode署名と別です。実行先にもWebView2が必要です。

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`のバージョンを同じ値へ更新し、lockfileを更新してmainへpushすると、検査後にActionsがタグ・インストーラー・署名・`latest.json`を自動公開します。同じバージョンの通常コミットでは再配布しません。[配布と自動更新](docs/distribution.md)を参照してください。

個別コマンド:

| コマンド | 用途 |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run design:guard` | テーマ外の生の色、フロントエンドの直接HTTP呼び出しを検出 |
| `npm test` | フロントエンドの動作テスト |
| `npm run build` | TypeScriptとViteビルド |
| `npm run native:check` | Rustの書式・静的検査・テスト |
| `npm run tauri -- info` | Tauri開発環境の診断 |

## コードと設計

- `src/`: UI、MUIテーマ、共通部品、型付きIPCラッパー。
- `src-tauri/`: Rustコマンド、ウィンドウ設定、CSPと最小権限。
- `AGENTS.md`: AIによる実装でも守るUIと責務のルール。
- [全体設計](docs/architecture.md): Self-Managed、プロジェクト/過去MR検索、MRレビューを中心としたアーキテクチャと開発順序。
- [UI設計](docs/ui-design.md): 画面構造、情報密度、共通部品、UIの一貫性を守る変更ルール。
- [採用調査と次の開発段階](docs/feasibility.md): 性能の見込み、制約、GitLab接続の設計方針。
- [検証結果](docs/validation.md): 初期ビルド、テスト、Windows実機での疎通確認。

MUIの描画はWebView2上です。実際の速度向上は、必要なAPIだけの取得・ページング・キャッシュ・一覧やdiffの描画制御で検証します。現在の土台だけではGitLab Webに対する速度改善は測れません。
