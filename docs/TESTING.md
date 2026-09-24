# テスト方法 · 1.2.0

## Node

Node.js 20以上。npm依存パッケージは不要です。

```sh
npm run check
npm test
npm run build
```

署名、フィルタ、並行要求、30件ページング、通信の打ち切り、永続プロフィールの利用、手動更新、保存失敗、NIP-05、公開リレー編集をテストします。IndexedDB部分は最小APIフィクスチャです。localStorage型のディスクアダプターは実際の別Nodeプロセスを使う復元試験も含みます。

## 今回の画面テスト

```sh
python3 -m pip install playwright cryptography websockets
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_persistence.py
```

Chromiumが別の場所にある場合はCHROMIUM_PATHを変更します。実DOMとネイティブES modulesを使いますが、WebSocket・localStorage・URL遷移・SHAの境界はテスト用です。現在仕様の65項目を検証し、`tests/output/persistence-browser-results.json` へ出力します。`browser_offline.py` と `browser_navigation.py` からハーネス関数を再利用します。この2つと `browser_profile.py` の直接実行は旧リリース用で、今回の画面検証コマンドではありません。

## 実HTTP・実保存APIを使う追加確認

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
```

localhostにHTTP/WebSocketを起動し、実IndexedDB・実URL・共有接続を確認するための1.2.0用スクリプトです。NIP-05のHTTPと署名拡張はテスト用に置換します。実秘密鍵や公開リレーを使いません。今回の実行環境ではブラウザーのURLアクセスが管理ポリシーで拒否されたため、このスクリプトの通過は確認していません。

通常のFirefoxでも、次の条件を確認できます。プロフィールを明示取得した後にタブを閉じて再び開き、取得ボタンを押さず保存済みの名前が出ること。NetworkのWSログでアクセスだけではREQがないこと。既知の人を含む投稿を取得してもkind:0のフィルタがなく、プロフィール更新ボタンではその人のkind:0だけが送信されること。StorageのIndexedDBにはkind:0のみがあり、投稿・フォロー・ミュート・公開リレーがないこと。設定のリレーはlocalStorageの従来設定に残ること。

## 再現可能な通信比較

```sh
# 現在版のみ
npm run benchmark
# 別ディレクトリへ展開した、変更していない1.1.1と比較
node scripts/benchmark-persistence.mjs --baseline /path/to/1.1.1/mikeryan
# 結果の上書きを避ける場合
node scripts/benchmark-persistence.mjs --baseline /path/to/1.1.1/mikeryan --output /tmp/traffic.json
```

旧版の自動ダウンロードはしません。以前のZIPを展開して使います。標準出力と `docs/persistence-traffic-results.json` に計測を出します。旧 `scripts/benchmark.mjs` は1.1.0→1.1.1用の過去の比較器で、今回のレポートとは別です。

すべての署名鍵は公開のテスト専用フィクスチャです。実アカウントやウォレットに使わないでください。
