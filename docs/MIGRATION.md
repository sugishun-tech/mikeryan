# 更新と移行 · 1.2.0

## 1.1.1から

全体ZIP、または1.1.1からの差分ZIPの `mikeryan/` 内を同じ位置へまとめて上書きします。`js/profiles/cache.js`、`relay-list.js`、`relays-view.js` 等の新規モジュールも必要です。一部だけの更新ではなく、依存JS・CSS・入口・SharedWorkerを1.2.0にそろえます。

差分ZIPには `default.json` を含めません。独自の初期設定を保ってください。設定ページのリレー設定・ログイン・下書き・未達送信の形式はそのままで、サイトデータの削除は不要です。HTMLが古い場合は強制再読み込みを使えますが、ストレージの全消去はしないでください。

1.1.1には永続プロフィールがなかったため、1.2.0で初めて取得した人からキャッシュが作られます。初回の取得コストは消えません。以後は同じブラウザープロファイル・オリジン・配信パス内で再利用します。ブラウザーを変える、配信パスを変える、サイトデータを削除する、容量不足になる場合は保存を再利用できないことがあります。

アクセスだけでは投稿・公開リストを取りません。各取得ボタンを押してください。保存済みプロフィールは表示し、未知の人は「プロフィールを更新」または投稿・ユーザー一覧の明示取得によって初取得されます。プロフィール更新は投稿一覧を再読込しません。

自分のプロフィールの公開リレー編集はNIP-65を変更します。設定の接続先は変えません。公開リストが空でも接続先設定からURLを勝手に埋めません。

## 1.0系から

全体版で更新してください。過去の一般キャッシュ用IndexedDBは新しいプロフィール専用DBとは別で、自動取込み・自動削除しません。1.0系の未達送信は旧DBに入っている場合があるため、残っている場合は旧版で処理してから更新してください。1.1系以降の未達送信は従来のlocalStorage形式です。

## 元の2プロジェクトから

同じオリジンに残っている `nostr_relays`、`nostr_mute_display_name_patterns`、`nostr_mute_content_patterns`、`nostr_muted_pubkeys`、`nostr_profile_viewer_relays`、`nostr_profile_viewer_last_login_pubkey` の移行処理は維持しています。オリジンが変わる場合は旧保存領域へアクセスできません。ページ件数は最大30へ正規化します。

## URL

同じ `index.html` で処理し、サーバー側のリライトは不要です。

```text
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
