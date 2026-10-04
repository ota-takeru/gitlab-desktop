# 配布と自動更新

公開リポジトリ `ota-takeru/gitlab-desktop` のバージョンを上げてmainへpushすると、検査後に署名済みWindows NSISリリースを自動公開します。配布版は起動時と表示中の6時間ごとに更新を確認します。未保存の入力や送信処理がなく、2分間操作がないときに自動インストール・再起動します。更新通知の「後で」から延期できます。

## GitHub 側の設定

公開リポジトリで次の値を設定します。

| 種類 | 名前 | 内容 |
| --- | --- | --- |
| Repository variable | `TAURI_UPDATER_PUBLIC_KEY` | `tauri signer generate` で生成した公開鍵。改行なしの一行で保存 |
| Repository secret | `TAURI_SIGNING_PRIVATE_KEY` | 署名秘密鍵。リポジトリやチャットにコミットしない |
| Repository secret（任意） | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 秘密鍵に設定したパスワード |

秘密鍵はローカルの安全な場所で生成し、公開鍵だけを `TAURI_UPDATER_PUBLIC_KEY` に登録します。Actions はこの repository variable を署名用スクリプトの `TAURI_UPDATER_PUBKEY` 環境変数へ渡します。GitHub Actions のログへ秘密鍵やパスワードを出力する手順は追加しないでください。公開鍵、配布 URL、署名済み NSIS ファイルは公開されます。

## リリース手順

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` のバージョンを同じ SemVer に更新し、lockfileを更新してmainへpushします。Actionsが検査後にタグを作成し、公開します。手動でタグを作成する場合は次の方法も使えます。

```powershell
$version = "0.1.0"
git tag "v$version"
git push origin "v$version"
```

リリースワークフローはタグを検証し、3 つのバージョンが一致しない場合や、タグがチェックアウトされたコミットを指していない場合は停止します。main への push で 3 つのバージョンが前のコミットから変わっていれば、Actions がそのコミットへ `v<version>` タグを作成して同じ実行で公開します。同じバージョンの通常の main push は公開せず、既存のタグも再利用しません。`scripts/release-config.mjs` は Actions の repository variable から公開鍵だけを読み、固定した次の URL と NSIS 設定を含む一時的な Tauri 設定を生成します。

`https://github.com/ota-takeru/gitlab-desktop/releases/latest/download/latest.json`

ワークフローは `tauri-apps/tauri-action` で `latest.json`、NSIS セットアップファイル、署名ファイルを同じ公開 GitHub Release にアップロードします。既存の `v<version>` タグを GitHub の Actions 画面から `workflow_dispatch` で選んで再実行することもできます。その場合もタグとバージョンの一致、およびタグがチェックアウトされたコミットを指すことを検証します。

main ブランチへの通常の push は、バージョンが変わっていない限り CI の Windows 検査だけを実行します。バージョンを更新した main への merge は上記の自動リリース対象になります。`v*` タグの push と `workflow_dispatch` による既存タグの再実行も利用できます。

## アプリ側の動作

`UpdatePanel` はデスクトップ起動時に一度確認し、ウィンドウが表示中のときだけ 6 時間ごとに再確認します。ブラウザプレビューでは Tauri コマンドを呼ばず、更新未設定として表示します。Rust 側の `check_app_update` は固定したHTTPS配布元から利用可能なバージョンとリリースノートを取得します。インストール時に署名を検証します。実クライアント画面は未保存入力と送信処理を監視し、安全な場合だけ `autoInstallAllowed` を有効にします。通知と延期ボタンを表示したうえで、操作のない状態が2分続くと自動インストールします。延期、非表示ウィンドウ、または安全でない状態では自動インストールしません。未保存入力と送信処理がある間は手動ボタンも無効になります。

フロントエンドは URL、公開鍵、秘密情報を受け取りません。更新先は配布ビルド時に生成される Tauri 設定へ固定し、IPC は `src/lib/updater.ts` の型付きラッパーだけを経由します。GitLab の認証情報や更新署名鍵を localStorage、ブラウザ状態、ログへ保存する機能はありません。

更新のダウンロード・適用中は閉じられないダイアログで入力・投稿を止めます。認証失効でアカウント別画面がリセットされても、このダイアログと更新処理は維持します。更新が失敗した場合はエラーを表示し、通常操作へ戻ります。

## ローカル検証

v0.2.0では、更新を適用する直前にも端末の未送信コメントの保存待ちを完了します。保存失敗時は更新を停止して本文を保持します。復旧画面から再表示した後も、メモリに保持した入力がある間は更新を待機します。

公開鍵を一時的に環境変数へ設定すると、署名用設定だけを生成できます。秘密鍵の値をコマンド履歴やログへ残さない方法で実行してください。

```powershell
$env:TAURI_UPDATER_PUBKEY = '<public-key>'
node scripts/release-config.mjs
node --test scripts/release-config.test.mjs
```

生成された `src-tauri/tauri.release.conf.json` は署名用の一時ファイルで、Git管理から除外しています。秘密鍵はリポジトリ外で保管し、GitHub ActionsのRepository secretで署名します。Tauriの更新署名とWindowsのAuthenticode署名は異なる仕組みです。現在の配布は更新署名付きであり、企業のコード署名証明書は使用していません。

Actions が成功したら、Release の Assets に次があることを確認します。

- `latest.json`
- Windows NSIS セットアップファイル
- セットアップファイルに対応する `.sig`

`latest.json` が公開されるまで、アプリ側の確認結果は「更新を確認できませんでした」または現在版のままです。署名検証に失敗したアーティファクトをインストールへ進めないことが更新経路の前提です。
