# テスト方法 · 1.3.4

## 実行済み

Node.js 20以上。npm依存パッケージは不要。

```sh
npm run check
npm test
npm run build
```

今回の環境はNode.js v24.22.1。Nodeテスト349件が合格した。結果と限界は[検証結果](./TEST_RESULTS.md)を参照。

重点回帰テストだけを実行する場合:

```sh
node --test tests/media-duplicates.test.js tests/post-actions.test.js tests/audit.test.js tests/traffic.test.js
```

`media-duplicates.test.js`と`post-actions.test.js`は、本体の描画クラスを限定的なDOM・イベントのフィクスチャで実行する。実ブラウザーのレイアウトや通信の代替とはしない。kind:7の送信拒否、通常投稿の継続、受信通知の取得は実際のSocial・Repositoryも使って検証する。

## ブラウザーでの確認

Playwright、cryptography、Pillow、Chromiumが必要。

```sh
python3 -m pip install playwright cryptography pillow
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
MIKERYAN_TEST_FAST=1 CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_persistence.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_audit.py
```

`browser_content.py`は画像・YouTube・X・Nostr参照・リポスト・引用、同一URLの投稿間表示、最大深度2、一投稿1枠、失敗時のリンク、後片付け、モバイル幅を検査する。実DOM・ネイティブES modulesを使うが、通信・保存・履歴・署名拡張・SHA・画像取得・外部フレームの通知は明示的なアダプターを使う。実サービスでの再生成功やCSPを保証するテストではない。

今回、このコマンドはChromiumの起動が環境のsocket権限制限で遮断され、ブラウザー試験まで進めなかった。Pythonの構文だけは検査済み。対応環境で実行すると、結果と画面キャプチャは`tests/output/`へ出力する。

## その他の同梱スイート

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_completeness.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_relationships.py
python3 tests/transport_integration.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
```

上記は今回再実行していない。`browser_offline.py`と`browser_navigation.py`は現行試験のハーネスを提供するが、この2つと`browser_profile.py`の古い直接実行部分は過去の自動取得仕様用。現行版の合格数には含めない。

公開のテスト鍵は実アカウントやウォレットには使用しない。配布する`default.json`やユーザーの設定はテストで書き換えない。

## 通信ベンチマーク

```sh
node scripts/benchmark.mjs --output /tmp/mikeryan-traffic.json
node scripts/benchmark-persistence.mjs --output /tmp/mikeryan-persistence.json
```

現行版では自分のいいね同期を行わない。外部の旧版を`--baseline`で比較する場合、差には機能削除による通信削減も含まれる。既存のTRAFFIC.mdと通信比較JSONは過去版の記録であり、今回の削減率ではない。
