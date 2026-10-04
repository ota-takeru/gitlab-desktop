# Rust + MUI の採用調査

調査日: 2026-09-30。対象: 個人用、Windows優先のGitLabデスクトップクライアント。

要件具体化後の設計は[全体設計](architecture.md)を参照。Self-ManagedのMR閲覧とプロジェクト・過去MR検索を初期版の中心に据えている。この文書は初回の採用調査として残す。

## 判断

この構成で着手してよい。Tauri 2がRustとReact/MUIの接続を担う。MUIはReactのライブラリなので、UIはTypeScript/React、OS連携とAPI処理はRustという分担になる。

ただし、Tauri化だけでGitLab Webより速くなるという判断はできない。WindowsではWebView2によるHTML/CSS描画が残る。GitLabサーバーの応答時間も残る。改善の主因は、利用する作業だけを小さく実装し、取得・描画する量を制限できること。Web UI全体の再実装を目指すと保守負担が大きい。

| 論点 | 判断と進め方 |
| --- | --- |
| デスクトップ基盤 | Tauri 2を採用。OSのWebViewを使い、Rustコマンドを型付きラッパーから呼ぶ |
| UI | React + TypeScript + MUI。テーマと共通部品を唯一の基準にする |
| API | まずREST v4。MR、Issue、Pipelineのうち優先する一つから実装 |
| データ取得 | Rustで非同期HTTP。UIへ必要なDTOだけ返す。初期段階では巨大な状態管理ライブラリを増やさない |
| キャッシュ | 次段階でSQLite等を検討。まず一画面の実測を取り、容量・期限・アカウント分離を設計 |
| 認証 | 個人用途の初期検証は最小権限PATが候補。継続利用・配布ではOAuth PKCEも比較 |
| 配布 | 今回はローカル実行ファイルまで。署名、インストーラー、自動更新は別段階 |
| 別案 | Web描画自体を排除したいならegui/iced等のRust UIを別途評価。その場合MUIの利用はできない |

## 性能改善の設計案（未実装・未計測）

1. 初回は一画面・一ページのみ取得。ページサイズは20〜50件を出発点にし、APIの次ページ情報を使う。全件取得はしない。
2. キャッシュを即時表示し、更新日時と再取得中の状態を見せる。手動更新と低頻度のバックグラウンド更新を分ける。
3. キャッシュキーにinstance/account/project/filterを含める。進行中リクエストの重複をまとめ、画面変更後の古い結果を適用しない。
4. API同時実行数とタイムアウトに上限を設ける。429はRetry-Afterに従う。非表示ウィンドウでのポーリングを抑える。
5. 長い一覧はページング、必要なら仮想化。diff、Markdown、CIログは開いたときに読み、サイズを制限する。
6. CPU負荷のあるdiff解析や検索をUIスレッドで行わない。Rustの非同期処理にも同期の重い作業を載せない。

受入目標の候補: キャッシュ済み一覧の切替p95を100ms以内、コールド起動から操作可能まで2秒以内。これは保証や現時点の実測ではない。GitLab接続後、同じPC・同じプロジェクト・同じデータ量で、Webとreleaseビルドの起動、一覧表示、詳細表示、検索を比較する。各条件を複数回測り、ネットワーク待ちと描画時間を分離する。メモリはアプリ本体だけでなくWebView2子プロセスも合算する。

## UIのぶれを抑える運用

MUIだけでは独自の余白、色、密度の増殖を防げない。テーマのトークン・MUI既定値・共通レイアウト・状態表示・UIカタログを基準にする。AGENTS.mdに変更ルールを置き、静的チェックで生の色と直接HTTPを検出する。静的チェックは全ての見た目を保証しないため、追加画面は明暗テーマ、キーボード操作、最小ウィンドウで目視確認する。データ画面が確定した段階で代表状態のスクリーンショット回帰テストを追加する。

## GitLab接続前に決めること

- GitLab.com / Self-Managed、Self-Managedならバージョン、URLのサブパス、VPN・プロキシ・社内CAの有無。
- 最も遅い作業と頻度: MR一覧、レビューdiff、Issue検索、Pipeline/ログ等。
- 閲覧専用でよいか。コメント、承認、マージ、再実行などの書き込みは別の権限・操作設計にする。
- トークン発行可否、SSOと組織ポリシー。秘密値をチャットへ貼る方式にはしない。

認証実装ではOSの資格情報ストアを利用し、フロントエンドへトークンを返さない。HTTPS検証を保つ。リダイレクトやページングURLに従う際は、資格情報を別ホストへ送らない。Markdownやdiff等の外部データは信頼せず、HTML挿入を避ける。ローカルキャッシュも私的データとして扱う。

## 段階的な開発順

1. 今回: 再現可能なビルド、テーマ、画面枠、UIカタログ、Rust IPC疎通。
2. 接続先を決め、最小権限の認証と一種類の一覧取得・ページング・エラー表示を実装。
3. 実測に基づくキャッシュと詳細表示。Webとの比較で改善効果を判定。
4. 必要な書き込み操作、通知、検索等を追加。配布が必要になった時点で署名・更新を設計。

## 一次資料

- [TauriのWindows前提条件](https://v2.tauri.app/start/prerequisites/) — C++とWebView2。
- [TauriのWebView](https://v2.tauri.app/reference/webview-versions/) — プラットフォームごとの描画基盤。
- [Tauriの権限](https://v2.tauri.app/security/capabilities/) / [CSP](https://v2.tauri.app/security/csp/) — IPCとWebViewの境界。
- [MUIの導入](https://mui.com/material-ui/getting-started/installation/) / [テーマ](https://mui.com/material-ui/customization/theming/) — React依存と一元化した外観設定。
- [GitLab REST API](https://docs.gitlab.com/api/rest/) — ページングはエンドポイントとバージョンに依存。対応する場合はkeysetを利用。
- [GitLab API認証](https://docs.gitlab.com/api/rest/authentication/) — トークンとレート制限。
- [GitLab OAuth](https://docs.gitlab.com/api/oauth2/) — PKCEとアプリ登録。

接続先の実サーバーにはまだアクセスしていない。性能改善幅、組織固有の認証、GitLabバージョン互換性は未検証。
