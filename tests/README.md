# テストの入口 · 1.2.3

現行の再現手順、アダプター、必要な実行環境、未検証範囲は [docs/TESTING.md](../docs/TESTING.md)、実行結果は [docs/TEST_RESULTS.md](../docs/TEST_RESULTS.md) にまとめています。

```sh
npm test
MIKERYAN_TEST_FAST=1 python3 tests/browser_persistence.py
python3 tests/browser_completeness.py
python3 tests/browser_relationships.py
python3 tests/browser_audit.py
python3 tests/transport_integration.py
```

Node211件、Chromiumは65+34+30+47の176項目、localhost実WebSocket9項目。Chromiumの場所が異なる場合は `CHROMIUM_PATH` を指定します。実WebSocket試験はNode22以上が必要です。

`browser_smoke.py` は実HTTP・IndexedDB・SharedWorkerの追加試験で、今回の環境ではURLアクセスが遮断され未通過です。`browser_offline.py` / `browser_navigation.py` のハーネスは再利用していますが、この2つと `browser_profile.py` の直接実行部分は旧仕様用です。現行の通過件数に含めていません。

署名鍵とイベントは公開のテスト専用フィクスチャです。実アカウントやウォレットには使用しないでください。変更履歴はルートのCHANGELOG.mdのみです。

## Rich content (1.3.0)

`node --test tests/content.test.js` runs 70 new reference/parser/resolver cases.
`python3 tests/browser_content.py` runs 99 DOM/media/sandbox checks.
Pillow supplies a local image fixture. X widgets and YouTube messages are mocked;
live providers and real HTTP CSP are NOT covered. See docs/TESTING.md.
