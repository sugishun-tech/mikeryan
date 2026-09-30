# 更新と移行

更新履歴と各版の注意はルートの [CHANGELOG.md](../CHANGELOG.md) に集約します。

## 現在版の配置

全体ZIPの `mikeryan/` 内を同じ位置へ配置します。入口・依存JS・CSS・SharedWorkerを1.3.2でまとめて更新してください。更新後は強制再読み込みしてください。独自の `default.json` とブラウザー内の設定・ログイン・下書き・プロフィールは保持し、サイトデータは消去しません。古いUPDATE文書が既存リポジトリに残る場合はCHANGELOG記載の5ファイルを削除してください。

### X埋め込みを撤去する更新

X/TwitterのURLは通常リンクのみになります。ミュート・画像表示・リレーなどの設定変更は不要です。上書きコピーだけでは旧ファイルが残るため、既存の配信先から次のファイルも削除してください。1.3.2のZIPには含まれていません。

```text
assets/embeds/x.html
assets/embeds/x.css
js/content/x-frame.js
js/content/x-diagnostics.js
docs/x-embed-check.html
docs/x-embed-check.css
```

新しいアプリは旧ファイルが残っていても呼び出しませんが、旧確認ページを直接開けないよう削除してください。Git管理下なら削除分もコミットします。`default.json` とブラウザーのサイトデータは削除しません。

同じオリジン・配信パスなら既存のプロフィール保存を再利用します。ブラウザーやパスを変えると元の保存領域にはアクセスできません。投稿と公開リストは取得ボタンで読み直し、プロフィールは本人の「プロフィールを更新」で明示更新します。補助情報の再取得ボタンは保存済みプロフィールの強制更新ではありません。

## 1.0系から

全体版で更新してください。過去の一般キャッシュ用IndexedDBは新しいプロフィール専用DBとは別で、自動取込み・自動削除しません。1.0系の未達送信は旧DBに入っている場合があるため、残っている場合は旧版で処理してから更新してください。1.1系以降の未達送信は従来のlocalStorage形式です。

## 元の2プロジェクトから

同じオリジンに残っている `nostr_relays`、`nostr_mute_display_name_patterns`、`nostr_mute_content_patterns`、`nostr_muted_pubkeys`、`nostr_profile_viewer_relays`、`nostr_profile_viewer_last_login_pubkey` の移行処理は維持しています。オリジンが変わる場合は旧保存領域へアクセスできません。ページ件数は最大30へ正規化します。

## URL

同じ `index.html` で処理し、サーバー側のリライトは不要です。

```text
#/address/<naddr>
#/global
#/home
#/notifications
#/settings
#/me
#/profile/<hex>/posts
#/profile/<hex>/following
#/profile/<hex>/followers
#/profile/<hex>/mutes
#/profile/<hex>/relays
#/thread/<event-id>
```

## 埋め込みが表示されない場合

default.jsonにあるhttps / nostr\:等の本文ミュートを維持しています。該当投稿を表示する場合だけ、設定で対象パターンを削除してください。画像表示設定も有効にします。X/Twitterは常に通常リンクです。それ以外で本文が見えていてリンクだけになる場合は、1投稿1枠・深度1・同一メディアの重複抑制・接続先リレー・外部サービス/CSP制限を確認してください。埋め込みが失敗しても残ったリンクから開けます。外部HTMLの配信を阻止するCSPをホスティング側で追加している場合もリンク表示になります。
