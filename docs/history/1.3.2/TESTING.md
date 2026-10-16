# テスト方法 · 1.3.2

## 今回実行した検査

Node.js 20以上。npm依存パッケージは不要です。今回の実行環境はNode 22.16.0とChromium 144.0.7559.96です。

```sh
npm run check
npm test
python3 tests/browser_content.py
npm run build
```

Nodeは310件、本文のブラウザー試験は118項目です。現在版の結果と範囲は [検証結果](./TEST_RESULTS.md) に記載しています。テスト数は旧X表示試験を含めず、現在のソースを実行した件数です。

ブラウザー試験の依存関係はPlaywright、cryptography、Pillowです。Chromiumのパスは必要に応じて指定してください。

```sh
python3 -m pip install playwright cryptography pillow
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
# X/Twitterを通常リンクに限定する回帰試験のみ
node --test tests/x-links.test.js
# 本文解析・参照取得の試験のみ
node --test tests/content.test.js
```

`browser_content.py` は実DOM・ネイティブES modulesを使います。通信・保存・履歴・署名拡張・SHA計算、画像の取得、YouTubeの通知は明示的なテストアダプターを使います。X widgetsやX専用フレームの模擬実装はありません。X/Twitterリンクを表示してもiframeや埋め込みジョブが作成されないこと、元のリンクと安全属性が残ること、後続の画像・Nostr・YouTube・q引用を妨げないことを検査します。

ブラウザー試験ではミュートを無効にした一時設定を使います。ユーザーの保存設定、配布するdefault.json、実アカウントは変更しません。画像生成用のPillowはテストだけの依存です。

NIP-21の5形式、画像・NIP-92、YouTube、kind:6/16とqタグ、正常・失敗・複数・ネスト・混在・重複抑制・DOM上限・モバイル・後片付けの既存試験も実行します。結果は `tests/output/content-browser-results.json`、スクリーンショットは `tests/output/` に出力します。CSP違反イベントの注入はCSPの実適用確認ではありません。公開リレー・実サービスの画像取得・YouTubeの実再生は検証していません。

## その他の既存スイート

以下のスイートも引き続き同梱しますが、1.3.2の変更では再実行していません。過去結果を今回の合格数に加算しません。

```sh
MIKERYAN_TEST_FAST=1 CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_persistence.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_completeness.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_relationships.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_audit.py
# Node 22以上の標準WebSocket、Python websocketsを使用
python3 tests/transport_integration.py
# 通常のURLアクセスが可能な環境で実HTTP等を確認する追加スイート
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
```

`browser_offline.py` / `browser_navigation.py` は現行試験が利用するハーネスを含みます。この2つおよび `browser_profile.py` の古い直接実行部分は過去の自動取得仕様用です。現行仕様の通過数として数えないでください。

公開テスト鍵のフィクスチャ再生成は `python3 tests/fixture_content.py` です。フィクスチャ鍵は公開のテスト専用であり、実アカウントやウォレットに使用しないでください。旧X用のbridge・診断・実通信試験は機能とともに削除しました。

## 過去の通信比較

TRAFFIC.mdと通信比較JSONは過去版の記録です。今回の通信削減率ではありません。計測し直す場合は過去ログを上書きしない出力先を指定します。

```sh
node scripts/benchmark-persistence.mjs --output /tmp/traffic.json
```
