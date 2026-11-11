# テスト方法 · 1.3.5

## 実行方法

Node.js 20以上。npm依存パッケージは不要。

```sh
npm run check
npm test
npm run build
```

実際に実行した環境・合格数・検証範囲は[検証結果](./TEST_RESULTS.md)を参照。過去版の数値を現行版の実績として扱わない。

重点回帰テストだけを実行する場合:

```sh
node --test tests/reaction-replies.test.js tests/post-actions.test.js tests/audit.test.js tests/traffic.test.js
```

`media-duplicates.test.js`と`post-actions.test.js`は、本体の描画クラスを限定的なDOM・イベントのフィクスチャで実行する。実ブラウザーのレイアウトや通信の代替とはしない。汎用経路でのkind:7送信拒否、通常投稿の継続、受信通知の取得は実際のSocial・Repositoryも使って確認する。

`reaction-replies.test.js`で通知への返礼を検査する。受信kind:7だけにボタンが付くこと、最後のe/pタグと所有者の判定、NIP-25の送信タグ、赤い送信済み表示、連打・タブ間・再読み込み時の重複抑止、保存失敗時の送信停止、未完了照合時の送信停止、同一署名イベントだけの再送、アカウント切替を重点的に確認する。テストには公開の署名済みフィクスチャと模擬リレーを使い、公開リレーへ実際のいいねを送信しない。

## ブラウザーでの確認

Playwright、cryptography、Pillow、Chromiumが必要。

```sh
python3 -m pip install playwright cryptography pillow
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_reaction_replies.py
MIKERYAN_TEST_FAST=1 CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_persistence.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_audit.py
```

`browser_content.py`は画像・YouTube・X・Nostr参照・リポスト・引用、同一URLの投稿間表示、最大深度2、一投稿1枠、失敗時のリンク、後片付け、モバイル幅を検査する。実DOM・ネイティブES modulesを使うが、通信・保存・履歴・署名拡張・SHA・画像取得・外部フレームの通知は明示的なアダプターを使う。実サービスでの再生成功やCSPを保証するテストではない。

`browser_reaction_replies.py`は通知ハートの対象制限、送信状態、再読み込み、未完了送信の操作をローカルの試験データで確認する。実アカウントや公開リレーを使う統合試験とは区別する。

対応環境で実行すると、結果と画面キャプチャは`tests/output/`へ出力する。起動できなかった試験や構文検査だけで終わった試験は、ブラウザーでの合格に数えない。

## その他の同梱スイート

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_completeness.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_relationships.py
python3 tests/transport_integration.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
```

各スイートの実行有無は検証結果に記録する。`browser_offline.py`と`browser_navigation.py`は現行試験のハーネスを提供するが、この2つと`browser_profile.py`の古い直接実行部分は過去の自動取得仕様用。古い仕様の結果を現行版の合格数には含めない。

公開のテスト鍵は実アカウントやウォレットには使用しない。配布する`default.json`やユーザーの設定はテストで書き換えない。

## 通信ベンチマーク

```sh
node scripts/benchmark.mjs --output /tmp/mikeryan-traffic.json
node scripts/benchmark-persistence.mjs --output /tmp/mikeryan-persistence.json
```

通常フィードにいいね同期の問い合わせは追加しない。通知の明示読み込みでは返礼対象の既存いいねを照合し、新規送信の直前にも単一対象を全設定リレーで確認する。この通信をプロフィール装飾のREQや通常フィードの取得と区別して計数する。外部の旧版を`--baseline`で比較する場合、差には機能の追加・削除も含まれる。既存のTRAFFIC.mdと通信比較JSONは過去版の記録であり、現行版の削減率を示さない。
