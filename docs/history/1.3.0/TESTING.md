# テスト方法 · 1.3.0

## Node・静的検査・ビルド

Node.js 20以上。npm依存パッケージは不要です。今回の実行はNode 22.16.0です。

```sh
npm run check
npm test
npm run build
# 旧版で追加した47件の故障注入・履歴回帰だけ
node --test tests/audit.test.js tests/network-client.test.js tests/router-history.test.js
# 各100通りのページング生成データ
node --test tests/pagination-properties.test.js
# Node標準の実行カバレッジ。UIや実ブラウザー統合の網羅率ではない
node --test --experimental-test-coverage --test-coverage-include='js/**' tests/*.test.js
```

全281件。1.2.3の211件と、本文・埋め込み参照の新規70件です。旧版との失敗比較や具体的な観点は [検証結果](./TEST_RESULTS.md) にあります。実行結果のスキップや失敗を合格へ読み替えないでください。

## Chromium画面試験

```sh
python3 -m pip install playwright cryptography websockets pillow
MIKERYAN_TEST_FAST=1 CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_persistence.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_completeness.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_relationships.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_audit.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
```

それぞれ65、34、30、47、99項目、合計275項目。結果は `tests/output/` のJSONへ保存します。Chromiumのパスは環境に合わせて変更します。

実DOM・ネイティブES modulesを使用し、通信・保存・履歴・署名拡張・SHA計算にはテストアダプターを使用します。投稿を公開リレーへ送らず、実秘密鍵も使用しません。模擬通信の要求間隔は上記保存試験では環境変数により、残る4試験ではローダーにより無効化します。製品の要求間隔はNodeの別試験で確認します。

`browser_offline.py` / `browser_navigation.py` は現在試験が利用するハーネス関数を含みます。この2つおよび `browser_profile.py` の古い直接実行部分は過去の自動取得仕様向けで、上記の現行試験には含めません。古い単独エントリーを現行仕様の合格結果として扱わないでください。

## 実WebSocketを使うlocalhost試験

Node 22以上の標準WebSocketとPython websocketsを使います。

```sh
python3 tests/transport_integration.py
```

実行時に127.0.0.1の空きポートへ一時的なリレーを起動し、公開テスト鍵で署名したフィクスチャだけを送受信します。9項目の結果を `tests/output/transport-results.json` へ保存します。サーバーは実行終了時に停止し、署名付きの一時ファイルも削除します。公衆リレー・実拡張・ブラウザーを検証する試験ではありません。

## ネイティブのブラウザー統合確認

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
```

実HTTP・WebSocket・IndexedDB・URL・SharedWorkerを確認するためのスクリプトです。NIP-05とNIP-07は公開テストフィクスチャです。今回の環境では管理ポリシーがURLアクセスを遮断し、開始できませんでした。未通過として記録し、275項目にも9項目にも含めません。

通常の配信環境では、拡張機能の許可、CSP/CORS、保存容量、タブ間接続、戻る・進む、公衆リレーの認証・件数制限を別途確認してください。プロフィールを明示取得した後の再読み込みでも保存済みの名前が出ること、取得ボタンを押すまではREQがないこと、取得データの永続ストアがkind:0専用であることも確認点です。

## 過去の通信比較

```sh
# 現在の計測を過去の記録と分けて出力
node scripts/benchmark-persistence.mjs --output /tmp/traffic.json
# 元の1.1.1ソースを別途保持している場合だけ
node scripts/benchmark-persistence.mjs --baseline /path/to/1.1.1/mikeryan --output /tmp/traffic.json
```

同梱のTRAFFIC.mdとJSONは1.2.0の過去記録です。今回の全ケースの通信削減率ではありません。`npm run benchmark` は標準出力先の過去JSONを上書きするため、記録を残す場合は別の `--output` を指定してください。

すべてのフィクスチャ鍵は公開のテスト専用です。実アカウントやウォレットには使用しないでください。


## 新規の本文・埋め込み試験

```sh
node --test tests/content.test.js
npm run test:browser:content
# 公開テスト鍵のフィクスチャを再生成する場合
python3 tests/fixture_content.py
```

ブラウザー試験は本物のDOM・ES modules・Xの不透明sandboxを使います。画像の取得先を小さなPNGへ置き換え、Xのwidgets.createTweetとYouTubeの通知を模擬します。画像error、Xの拒否・空結果・スクリプト失敗・タイムアウト、YouTubeの初期/遅延エラー・CSP違反通知・タイムアウト・偽メッセージ、1枠・深度・混在・破損・重複・モバイル・後片付けを確認します。CSP違反イベント注入はCSPの実適用確認ではありません。画像生成用のPillowはテストだけの依存です。

公開サイトでの検証では、別々の投稿で各種リンクを先頭の対象候補にし、正常な公開投稿・削除/非公開投稿・埋め込み禁止動画・接続不能画像を確認してください。外部サービスに接続しない環境では模擬試験の成功を実表示成功と読み替えないでください。
