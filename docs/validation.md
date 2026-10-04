# 検証結果

## 入力保護と製品品質の強化（v0.2.0 / 2026-10-04）

- `npm run check`成功。フロントエンド162件、リリース設定3件、Rust54件、合計219件の通常テスト。lint / design guard / TypeScript / production build / Rust fmt / clippyが成功。既存Fast Refresh warning 6件、JSサイズwarningは残っている。
- `npm audit --omit=dev`で、本番JavaScript依存に報告済みの脆弱性0件。Rustや全依存の安全性を保証する検査ではない。
- schema 1から2への移行、未来schemaでのファイル非改変、アカウント別未送信コメントと結果不明記録、再起動復元、投稿前保存、成功時の本文・記録のatomic削除、中断と接続切替の競合、古い応答・UUID・二重確認をfixtureで検証。
- 差分1万行、全文2001行、議論101件、議論内ノート200件のテストで、一度のDOM描画件数と最終ページ到達を確認。ネットワーク性能や実機のp95ではない。
- GitLab.com公開プロジェクト検索の実通信が成功。公開MR匿名取得は401 `AUTH_REQUIRED`で失敗したため、取得成功や認証付きレビュー完了として数えていない。
- Windows資格情報ストアへ専用の架空値を一時保存・取得・削除する明示テスト成功。glab認証検査は期限切れOAuthを秘密値を出さず拒否した。有効なGitLab.com認証の実通信は未確認。
- ローカル署名付きNSIS build成功。インストーラー4,531,229バイト、SHA256 `55ABE5128D76ECA9C9E52748AD79B42D6BF7C778E0828AE5E74D65DF217641CA`。Rustで公開鍵との署名一致、内容1バイト改変で拒否を確認。公開CI配布物とは別のローカルbuildの記録。
- [Windows CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37203184795)と[署名付きRelease](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37203184764)が成功。タグ`v0.2.0`はソース`398862fbd013e789da19766b42865ce6a170af5d`を指す。配布処理は9分26秒で完了。
- 公開[インストーラー](https://github.com/ota-takeru/gitlab-desktop/releases/download/v0.2.0/GitLab.Desktop_0.2.0_x64-setup.exe)を匿名ダウンロード。4,538,262バイト、SHA256 `16A8E1C002DBED15505BED69A7CBD550EA382FE0483495F391237AD16FDE36BB`。対応する444バイトの署名をRustで検証し、1バイト改変の拒否も成功した。
- 公開latest endpointの`latest.json`（1429バイト）がversion `0.2.0`を返し、`windows-x86_64`と`windows-x86_64-nsis`の両方で上記インストーラーURLと署名が一致した。公開後のローカルbundleにはCI配布ファイルを置いて再検証したため、そこにあるファイルのhashは公開版と同じ。
- Computer Useは使用していない。新しい実画面、ネイティブ終了イベント、インストール・旧版からの更新と再起動は未確認。確認対象と残る項目は[製品品質の検証状況](product-readiness.md)にまとめた。

## glab保存済み認証の取り込み（v0.1.2 / 2026-10-04）

Windows x64 / glab 1.107.0。接続画面の明示操作からPATまたはOAuthアクセストークンをRustで取り込む経路を追加した。

- `npm run check`成功。最終修正後の`npm run native:check`も成功。フロントエンド101件、リリーススクリプト3件、Rust34件の通常テスト、lint、design guard、TypeScript/Vite、fmt / Clippyを含む。
- IPCがURLだけを送ること、取り込み成功・失敗、手動PATへの復帰、ブラウザープレビューでの無効化をUIテストで確認。
- 対象hostだけの選択、root・別hostへのフォールバック拒否、HTTPS・port・大文字小文字を含むサブパスの一致、OAuth期限・不正設定の拒否をRustテストで確認。refresh tokenをアクセストークンとして使用しない。
- 設定ファイルは1MiB・深さ32・10,000イベントに制限し、YAMLの重複キー・alias・anchor・tagを拒否。keyring用の一時設定には対象hostのメタデータだけを保存し、終了時に削除する。
- 固定コマンド、環境変数の分離、子プロセス出力の上限とタイムアウト、秘密値を含まないエラー、Bearerヘッダーの秘匿属性、既存PAT接続メタデータとの互換性を確認。
- 実glab 1.107.0のkeyring経路を隔離fixtureで確認。unique `.invalid` hostにfake tokenをWindows資格情報ストアへ登録し、対象hostだけの一時設定と固定CLIから一致する値を取得できた。fixture資格情報は削除し、不存在も確認。一時helperと設定を削除し、実認証・実設定は変更していない。
- 旧形式の`api_host: host/subpath`は別`subfolder`が空の場合だけ照合できることを確認。相対`GLAB_CONFIG_DIR`は拒否し、相対XDGパスは候補から除く。
- このPCの保存済みOAuthは期限切れ。修正前の読取は成功したが、本人確認APIは401を返した。修正後の明示実行テストでは期限切れを送信前に拒否し、glab側の認証更新を案内することを確認した。本物のトークンは表示・保存していない。
- ローカルの署名付きNSIS生成と署名検証・改ざん拒否テストに成功。[GitHub CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37199393484)と[自動リリース](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37199393466)も成功し、v0.1.2タグと[公開リリース](https://github.com/ota-takeru/gitlab-desktop/releases/tag/v0.1.2)を自動生成した。
- 公開先へ認証なしでアクセスし、NSIS（4,449,910 bytes）、署名、最新`latest.json`を取得。両Windows x64 platformのURL・署名・version一致、公開NSISの署名検証・改ざん拒否を確認。SHA-256: `3204491d67f1621fa4ea46eb27c9d215f03035b280452b1b5a6c9f18faae905c`。

初期JSは858.11 kB（gzip 264.45 kB）。既存のViteサイズ警告とFast Refreshのlint警告6件は残る。Computer Useは使用しておらず、今回追加したボタンの目視・実ウィンドウ操作は未検証。有効な実トークンによるGitLab.com本人確認・Self-Managed実機・OAuth自動refreshは検証済みとして扱わない。

## 実接続と配布の検証（2026-10-04）

Windows x64。以下の初期基盤・モックの記録とは別に、RustのGitLab APIクライアント、資格情報・永続キャッシュ、署名付き更新を実装した。

- `npm run check`成功。フロントエンド98件、リリーススクリプト3件、Rust21件の通常テスト、lint、design guard、TypeScript/Vite、Rust fmt / Clippyを含む。
- 接続復元、PAT消去、認証失効・古いセッション応答の分離、検索条件の適用・復元、自分の返信の編集・削除、キャッシュ先行表示、403の再取得ループ防止、画面を閉じた後の遅い応答拒否をUIテストで確認。
- 未送信本文を隠しても自動更新を止めること、pending書込みと結果不明状態の画面移動後の保持、二重投稿の抑制、アカウント別本文の分離・削除、署名付き更新の確認・待機・延期・手動再確認を確認。更新適用中の操作保護、認証失効時の保護継続、失敗時の通常操作への復帰も確認。
- Rustの通常テスト21件が成功。fmt / Clippy（全target、警告をエラー扱い）も成功。
- 明示実行の外部テスト3件が成功: GitLab.comの公開プロジェクトAPI、Windows資格情報ストアの保存・読出し・削除、生成したNSISの署名検証と1byte改ざんの拒否。
- HTTP fixtureでタイトル・説明検索のクエリ、プロジェクト内MR、サブパス・ファイルパス、ページング、401/429、GETの再試行上限、書込の単発送信、MR差分取得前後のhead変更拒否を確認。
- キャッシュのアカウント分離、保持期限・容量による退避、ログアウト後の遅い応答によるキャッシュ復活防止、処理待ちの上限・キャンセル、未来のDB schemaの拒否を確認。
- 署名付きWindows NSISをローカルで生成した。更新用署名鍵はソース外で管理し、GitHub Repository secretを設定済み。Authenticode署名ではない。
- [GitHub CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37191999302)と[自動リリース](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37191999309)が成功。mainのバージョン変更からv0.1.1タグと[公開リリース](https://github.com/ota-takeru/gitlab-desktop/releases/tag/v0.1.1)を自動生成した。
- 公開先から認証なしでNSIS（4,330,370 bytes）、署名、latest.jsonを取得。Windows x64用URL・署名の一致とSHA-256を確認し、公開インストーラーの署名検証・改ざん拒否テストも成功。

初期JSは857.45 kB（gzip 264.32 kB）。Viteのchunkサイズ警告と開発時Fast Refreshに関するlint警告は残るが、ビルド・型検査にエラーはない。この数値は起動時間や実データを含む描画性能の計測ではない。

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
