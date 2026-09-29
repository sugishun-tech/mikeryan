# 更新と移行

更新履歴と各版の注意はルートの [CHANGELOG.md](../CHANGELOG.md) に集約します。

## 現在版の配置

全体ZIPの `mikeryan/` 内を同じ位置へ配置します。新規 `js/social/followers.js` を含め、入口・依存JS・CSS・SharedWorkerを1.2.3でまとめて更新してください。更新後は強制再読み込みしてください。独自の `default.json` とブラウザー内の設定・ログイン・下書き・プロフィールは保持し、サイトデータは消去しません。古いUPDATE文書が既存リポジトリに残る場合はCHANGELOG記載の5ファイルを削除してください。

同じオリジン・配信パスなら既存のプロフィール保存を再利用します。ブラウザーやパスを変えると元の保存領域にはアクセスできません。投稿と公開リストは取得ボタンで読み直し、プロフィールは本人の「プロフィールを更新」で明示更新します。補助情報の再取得ボタンは保存済みプロフィールの強制更新ではありません。

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
