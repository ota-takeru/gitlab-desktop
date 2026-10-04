# 検証結果

## 実接続と配布の検証（2026-10-04）

Windows x64。以下の初期基盤・モックの記録とは別に、RustのGitLab APIクライアント、資格情報・永続キャッシュ、署名付き更新を実装した。

- `npm run check`成功。フロントエンド95件、リリーススクリプト3件、Rust21件の通常テスト、lint、design guard、TypeScript/Vite、Rust fmt / Clippyを含む。
- 接続復元、PAT消去、認証失効・古いセッション応答の分離、検索条件の適用・復元、自分の返信の編集・削除、キャッシュ先行表示、403の再取得ループ防止、画面を閉じた後の遅い応答拒否をUIテストで確認。
- 未送信本文を隠しても自動更新を止めること、pending書込みと結果不明状態の画面移動後の保持、二重投稿の抑制、アカウント別本文の分離・削除、署名付き更新の確認・待機・延期・手動再確認を確認。
- Rustの通常テスト21件が成功。fmt / Clippy（全target、警告をエラー扱い）も成功。
- 明示実行の外部テスト3件が成功: GitLab.comの公開プロジェクトAPI、Windows資格情報ストアの保存・読出し・削除、生成したNSISの署名検証と1byte改ざんの拒否。
- HTTP fixtureでタイトル・説明検索のクエリ、プロジェクト内MR、サブパス・ファイルパス、ページング、401/429、GETの再試行上限、書込の単発送信、MR差分取得前後のhead変更拒否を確認。
- キャッシュのアカウント分離、保持期限・容量による退避、ログアウト後の遅い応答によるキャッシュ復活防止、処理待ちの上限・キャンセル、未来のDB schemaの拒否を確認。
- 署名付きWindows NSISをローカルで生成した。更新用署名鍵はソース外で管理し、GitHub Repository secretを設定済み。Authenticode署名ではない。

初期JSは850.67 kB（gzip 262.50 kB）。Viteのchunkサイズ警告と開発時Fast Refreshに関するlint警告は残るが、ビルド・型検査にエラーはない。この数値は起動時間や実データを含む描画性能の計測ではない。

今回の作業ではComputer Useを使用しないという指定に従い、実接続画面の目視・キーボード操作による検証は行っていない。GitLab.comの認証付き取得・実投稿、Self-Managed実機、社内CA・プロキシ、実データ大量取得時の性能、自動更新による実インストール・再起動は未検証。API fixtureと公開APIの成功から、これらの成功を推定しない。

## 初期基盤

2026-09-30 / Windows x64。この記録はGitLabに未接続の0.1.0基盤に対するものです。

| 項目 | 結果 |
| --- | --- |
| Tauri環境診断 | WebView2、MSVC、Rust、Nodeを検出。必要条件を充足 |
| 開発起動 | `npm run desktop:dev`でViteとRustアプリが起動。Rust生成物をViteの監視から除外し、WindowsのEBUSYを解消 |
| 一括チェック | `npm run check`成功。開発サーバーと並行してもHTTP 200を維持 |
| ESLint | 成功 |
| フロントエンドテスト | 7件成功。プレビュー、遷移、IPC成功/失敗/待機等 |
| デザイン制約チェック | 成功 |
| TypeScript / Vite | 成功 |
| Rust fmt / Clippy | 成功。Clippyは警告をエラーとして検査 |
| Rust test | IPCのJSON契約テスト1件成功 |
| npm依存監査 | 報告された脆弱性0件（当日のnpm audit結果。全依存の安全性保証ではない） |
| Tauri releaseビルド | `npm run desktop:build -- --no-bundle`成功 |
| Windows実行ファイル | 8,678,400 bytes。WebView2等の実行環境は含まない |
| 本番画面でのIPC | runtime_infoがappVersion=0.1.0、os=windows、arch=x86_64を返す |
| 権限制限 | 許可していない`plugin:app\|name`がACLにより拒否される |
| 本番の遅延読み込み | UI catalogの分割JSを読み込み、表示できる |
| 本番コンソール | 最終起動・画面遷移・IPC確認でエラー/警告0件 |

Playwrightでブラウザープレビューと生成した実行ファイルのWebView2を操作。概要・MR・Issue・Pipeline・UI catalogの遷移、明暗テーマ、TabでのフォーカスとEnterでのテーマ変更を確認しました。1280×840と960×640のブラウザー表示を目視確認。ネイティブWebViewの1008×662表示では横方向のオーバーフローなし。

初期JSは456.73 kB（gzip 145.71 kB）、遅延読み込みするカタログは65.80 kB（gzip 20.23 kB）。Viteのサイズ警告はありません。これはビルド成果物のサイズであり、起動時間やメモリ消費、GitLab Webより速いことの証明ではありません。

検証画像はGit管理対象外の`output/playwright/`に保存しています。`final-native.png`が最終release版のRust疎通確認画面です。検証のため一時的に有効にしたWebView2デバッグ接続はプロセス終了時に停止し、アプリ設定には追加していません。

未検証: GitLab実接続、PAT/OAuth、社内CA/プロキシ、取得データを含む性能、署名・インストーラー、Windows以外のOS。次の判断材料は[採用調査](feasibility.md)を参照してください。

## 操作できるUIモックの検証

2026-09-30追記。`#mock`の架空データを使ったブラウザープレビューを検証した。実API・認証・永続キャッシュの検証ではない。

- `npm run check`成功。フロントエンド14件、Rust1件のテスト、ESLint、design guard、TypeScript/Vite、fmt/Clippyが成功。最後の入力欄レイアウト調整後もlint/buildを確認。
- 1280×840と960×640で明暗テーマを表示し、横方向のページオーバーフローがないことを確認。長いコード行は差分領域内で横スクロールする。
- Playwrightでタイトル/説明の検索、過去MRのMerged絞り込み、プロジェクト検索とお気に入り操作、一覧/詳細/カタログの移動を操作した。
- MR別の下書き保持、新規コメントへの返信、解決/再開、承認/取消、狭幅で一覧へ戻る動作を確認。Ctrl+Enterでの投稿シミュレーションとTabのフォーカス輪郭も確認した。
- 最終プレビューのブラウザーコンソールはエラー/警告0件。データ・下書き・投稿はメモリ内に限り、リロードでリセットする。
- `output/playwright/mock-review-dark.png`、`mock-review-light.png`、`mock-small-light.png`、`mock-catalog-dark.png`等に目視確認用画像を保存（Git管理対象外）。

このモックの機能はUI方針を確認するためのもの。実データの大量描画、仮想化の性能、GitLabとの投稿整合性や権限制御を保証するものではない。

## プロジェクト画面・コミット差分・概要の拡張

2026-09-30追記。上記モックに対する追加検証。

- `npm run check`成功。フロントエンド20件、Rust1件のテスト、ESLint、design guard、TypeScript/Vite、fmt/Clippyが成功。
- プロジェクト内のタイトル/説明検索、Open/Merged切替、Open 0件のData Catalogから過去MRを開く操作を確認。MRから戻った際に検索語とMerged条件が保持されることをブラウザーで確認。
- MR全体とコミット単位を切り替え、同じファイルの異なるパッチ、親SHA、ファイル選択のリセットを確認。コミット差分にMR全体の行コメントを重ねないこと、別MRでは全体表示へ戻ることを確認。
- 概要で既存コメントと返信本文を表示。返信ボタンから入力欄へフォーカスが移り、投稿シミュレーション後も概要タブに留まることを確認。付帯情報はキーボードのEnterで開閉できる。
- 明暗テーマ、1280×840と960×640の表示を目視確認。960×640でも概要の最初のコメント本文を初期表示で読め、ページ全体に横スクロールは発生しない。
- UIカタログは本体と同じMockProjectPageとMockReviewPaneを利用。カタログ内のプロジェクト検索・コミット切替も操作確認。
- 画像は`output/playwright/v2-project-dark.png`、`v2-project-light-960.png`、`v2-overview-dark.png`、`v2-overview-light-960.png`、`v2-commit-dark.png`、`v2-commit-light-960.png`、`v2-catalog-dark.png`（Git管理対象外）。

引き続き架空データによるUIモック。実GitLab接続、永続キャッシュ、レビュー件数増加時の性能は未検証。この追加分はブラウザーで検証し、Windows release実行ファイルの再生成は行っていない。

## 日常利用向けの画面枠の整理

2026-09-30追記。ロゴ・副題・重複ヘッダーを除去し、一行ナビゲーションと折りたたみ、下部ステータスバーに変更。

- `npm run lint`、`npm test -- --run src/pages/MockApp.test.tsx`（11件）、`npm run build`が成功。design guardとTypeScriptも成功。
- ブラウザーで折りたたみ前後の検索条件・選択MRの保持、アイコンからプロジェクト/検索/レビューへの移動、テーマ変更、常時見えるモック表示を確認。
- Tab/Shift+Tabによるフォーカス輪郭とEnterによる展開を確認。1280×840と960×640、明暗両テーマを目視確認し、狭幅でも下部操作が切れず、ページの横方向オーバーフローがないことを確認。
- 1280×840でのMR詳細領域は変更前790×798px（上端42px）、変更後814×816px（上端0px）。ナビゲーションを折りたたむと918×816px。ナビゲーション3行の高さは各36px。これはレイアウトの実測値であり、処理性能の計測ではない。
- 最終リロード後のコンソールはエラー/警告0件。検証画像は`output/playwright/shell-overview-dark.png`、`shell-overview-collapsed-dark.png`、`shell-expanded-light.png`、`shell-small-light.png`、`shell-small-dark.png`、`shell-keyboard-focus.png`。

## コミットタイムライン

2026-09-30追記。変更タブ上部の選択UIを、先頭にMR全体を置く横向きタイムラインへ変更。

- 関連するMockReviewPaneの3テスト、lint、TypeScript、design guard、Vite buildが成功。最終の接続線位置・表示例日時調整後にもlint/buildを再確認。
- ブラウザーでMR全体→1番目のコミット→末尾コミット→MR全体を操作し、同じファイルのパッチ内容・行コメントマーカー・ファイル選択が比較対象に応じて切り替わることを確認。
- 左右キー・Home・Endの選択と、12コミットのカタログ例で送りボタンによる横スクロールを確認。横スクロールは帯の中に留まり、ページ全体の幅は増えない。
- 1280×840と960×640で明暗テーマを目視確認。タイムライン本体は66px高で、差分の横幅を維持。長い件名は省略表示し、ツールチップとアクセシブル名に全文を含める。
- 最終リロード後のコンソールはエラー/警告0件。画像は`output/playwright/timeline-commit-dark.png`、`timeline-light.png`、`timeline-small-light.png`、`timeline-small-dark.png`、`timeline-many-dark.png`。

## ファイル全体の表示

2026-09-30追記。変更ファイルの見出しに「差分 / ファイル全体」を追加。

- `npm run lint`、`npm test`（27件）、`npm run build`が成功。design guardとTypeScriptも成功。
- 全8パスの架空ソースを用意し、MR全体・各コミットの全スナップショットで差分の新行番号と本文が一致することをテスト。MR全体と最新コミットの全文一致、旧コミットとの差異も確認。
- ブラウザーで全文の末尾までスクロールし、未変更部分を含む全文、コミット・ファイル切替時の表示モード保持、別MRでの初期化を確認。全文には削除行や行コメントマーカーを混ぜず、差分へ戻すとマーカーが表示される。
- 未取得内容と空ファイルの区別をコンポーネントテストで確認。UIカタログでも同じ全文表示を操作できる。
- 1280×840と960×640、明暗テーマの表示を目視確認。ページ全体の横方向オーバーフローなし。Tabで選択グループへ移動し、左右キーとEnterで表示を切り替え、2pxのフォーカス輪郭を確認。
- 最終リロード後のブラウザーコンソールはエラー/警告0件。画像は`output/playwright/full-file-dark.png`、`full-file-light.png`、`full-file-small-light.png`、`full-file-small-dark.png`、`full-file-end-dark.png`。

架空データによるUIモックの確認。実GitLabからのファイル取得・大容量ファイルの描画性能は未実装/未検証。Rustの変更やWindows release実行ファイルの再生成は行っていない。

## 議論を起点にするMR詳細

2026-09-30追記。タブを「議論 → 変更 → 概要」に変更し、初期表示を議論に統一。

- `npm test`（29件）、`npm run lint`、`npm run build`が成功。design guard、TypeScriptも成功。
- ブラウザーで初期表示、プロジェクト・過去MR検索からの遷移、カタログ内のタブ切り替えを確認。
- 概要は説明全文と短い付帯情報を表示し、議論一覧や入力欄を重複させない。概要との往復で新規コメント・返信下書きが保持され、返信フォーカス・投稿シミュレーションが動作することを確認。
- 変更タブのコミット切り替えとファイル全文表示も操作確認。1280×840と960×640、明暗テーマを目視確認し、狭幅で最初のコメント本文と返信が表示され、ページの横方向オーバーフローがないことを確認。
- 矢印キーとEnterによる議論・変更・概要の移動を確認。最終ブラウザーコンソールはエラー/警告0件。
- 画像: `output/playwright/discussion-first-dark.png`、`discussion-first-light.png`、`discussion-first-small-dark.png`、`discussion-first-small-light.png`、`overview-reference-dark.png`。

引き続きサンプルデータによるUIモック。実API・Rust・Windows release実行ファイルには変更なし。

## GitLab形式のコメント・レビュー操作

2026-09-30追記。通常コメント/スレッド、返信、旧/新行・ファイルへのコメント、Markdown表示、自分の投稿の編集・削除、未公開レビューの確認・公開・破棄をモックへ追加。

- 統合検証: `npm test`（10ファイル、57件）、`npm run lint`、`npm run build`が成功。TypeScript・design guardを含む。
- ブラウザーで通常コメントの追加・編集、返信によるスレッド化、親本文削除後の返信保持を確認。
- 未公開レビューでは件数・解決状態が変わらず、送信時に返信・解決・概要が反映されることを確認。旧側の行、コミット全文の行、ファイル全体のコメント対象も保持される。
- 未公開本文の編集、未保存編集中の送信禁止、任意の承認、破棄のキャンセル/確定、破棄後の概要・承認チェックのリセットを操作確認。MR間の保留レビューと行位置別の入力分離は統合テストで確認。
- Ctrl+Enterでレビューに追加、Ctrl+Shift+Enterで即時コメントを確認。Tab/Shift+Tabで行コメントボタンの可視化と2pxのフォーカス輪郭を確認。
- 1280×840 / 960×640の明暗テーマを目視確認。入力欄、Markdownプレビュー、狭幅での送信確認ダイアログを確認し、ページ全体の横方向オーバーフローなし。カタログ内の入力から保留レビュー確認も操作可能。
- 最終リロード後のコンソールは警告/エラーなし。途中のHMR・修正前スタイルに由来する旧ログとは分離して確認。
- 画像: `output/playwright/comments-dark-1280.png`、`comments-light-1280.png`、`comments-dark-960.png`、`comments-light-960.png`、`comments-light-dialog-960.png`。

対象はメモリ内のサンプル操作。実GitLabへの投稿、サーバー下書き、添付・Suggestion・権限判定は未実装。詳細は[対応方針](comment-review-parity.md)。RustとWindows release実行ファイルは今回変更していない。
