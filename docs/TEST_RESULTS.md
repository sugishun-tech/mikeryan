# 検証結果 · mikeryan 1.2.3

実行日: 2026-09-29。対象は配布する1.2.3ソース。比較対象は受領した `mikeryan-1.2.2-fixed.zip` のソース。ユーザーが特定した接続先リレーの相違と、以下の注入試験で再現した不具合は区別しています。

## 結果

| 試験 | 実行結果 |
| --- | --- |
| `npm run check` | 35モジュールの構文・相対import、入口アセット、CSP記載・必須ファイルの検査が通過 |
| `npm test` | **211件通過、失敗0、スキップ0、キャンセル0** |
| 保存・既存動作の画面試験 | 65項目通過 |
| 投稿・一覧欠落の画面試験 | 34項目通過 |
| 関係・相互表示の画面試験 | 30項目通過 |
| 横断的な遅延・失敗・画面操作の追加試験 | 47項目通過 |
| Chromiumの画面試験合計 | **176項目通過、各スイートで未捕捉JavaScriptエラーなし** |
| localhostの実WebSocket通信 | **9項目通過** |
| `npm run build` | 静的サイト生成と生成先のファイル検査が通過 |
| 実ブラウザーのHTTP・IndexedDB・SharedWorker統合 | **未通過。環境のURLアクセス制限で開始できず、合格件数から除外** |

Node 22.16.0、Python 3.13.5、Chromium 144.0.7559.96。npm依存パッケージなし。Pythonの画面試験はPlaywright、署名フィクスチャ作成はcryptography、localhost通信はwebsocketsを使用します。

## 旧版で失敗することも確認した回帰

追加した `audit.test.js`（36件）、`network-client.test.js`（6件）、`router-history.test.js`（5件）の計47件を1.2.2へ適用すると、**39件失敗・8件通過**。同じテストは1.2.3ですべて通過します。[旧版のNode生ログ](./audit-before.tap) を同梱します。公開リレー接続・実署名拡張は使用していません。

画面の追加試験は1.2.2で **14項目失敗・32項目通過**、1.2.3で **47項目通過**。旧版では新規アカウントの編集画面が開けず、その後の初回保存確認1項目へ到達しないため、実行項目数が異なります。その1項目を旧版の成功やスキップとして計数していません。[旧版の画面結果](./audit-browser-before.json) と [修正後の結果](./audit-browser-results.json) を参照してください。

失敗39件・14項目は、同じ不具合に対する複数の入力や確認を含みます。「53個の独立した不具合」という意味ではありません。1.2.2の既存Node162件・画面129項目は修正前にも通過しており、既存テストだけでは今回の問題を検出できませんでした。

## 観点別の確認範囲

| 観点 | 確認内容・主な入口 |
| --- | --- |
| ログインと署名 | 遅延ログイン、ログアウト、同じ鍵への再ログイン、署名キュー内の内容変更、暗号検証中の切替、書き込み前のアカウント変更。`audit.test.js` |
| 投稿・送信・下書き | 同時の部分送信、通信例外、同一イベントの再送競合、署名拒否、送信中の次の下書き、別アカウント画面への遅延完了。`audit.test.js` / `browser_audit.py` |
| 最新リストとプロフィール | 受信済みの新しい状態の保持、未知タグ・未編集項目の保持、不正JSONの拒否、初回プロフィール作成、変更なし保存。`audit.test.js` / `relay-editor.test.js` / `browser_audit.py` |
| 保存障害 | outboxの同時更新、別タブ相当の削除、容量不足時の古いディスク値、プロフィールの一時保持、移行設定の保存拒否。`audit.test.js` / `profile-cache.test.js` |
| 投稿・通知のページ境界 | 同秒、複数リレー・著者・条件、上限、部分応答、カーソル維持、重複、上下・最新。`pagination.test.js` / `completeness.test.js` / `pagination-properties.test.js` |
| フォロー・フォロワー・ミュート・相互表示 | 65人分の分割表示、主リストと補助情報の分離、署名された解除と未確認の区別、逆引き漏れ、複数リレー、全経路失敗時の更新と明示再試行。`relationships.test.js` / 画面3スイート |
| スレッドと画面寿命 | 投稿IDバッチの古い世代、失敗と不存在の区別、親情報取得失敗で本文・返信下書きを保持、リンク・戻る・進む・再読み込み。`audit.test.js` / `router-history.test.js` / `browser_audit.py` |
| 通信の失敗 | 古いsocketのclose、不正署名、EOSE、要求間隔、休止、SharedWorkerの送信失敗・停止・不正応答・手動フォールバック。`network.test.js` / `network-client.test.js` / `audit.test.js` |
| 表示と設定 | 不正な設定JSONの拒否、通常画面での継続操作、未信頼HTMLの文字表示、320/390/768px、スクロール時の無通信、3ボタン・最大30件。画面試験 |

生成データのページング試験は、**100個の固定seedそれぞれに対し下方向と上方向**を実行します。同秒集中、複数著者、欠落・重複なし、終了、最大30件、上方向の最も近い投稿を確認します。これは2個のNodeテスト内部の反復であり、200件を211件へ別途加算していません。任意のリレー動作に対する形式証明ではありません。

## 実通信とテストアダプターの区別

`transport_integration.py` は、その実行だけで作るlocalhostのPythonリレーへ **Node標準のWebSocket** で接続し、製品のRelayPool・RelayConnection・暗号検証を使います。分割フレーム、重複イベント、EOSE/CLOSE、投稿OK、NIP-42、EOSE前の実切断、自動再接続しないことを確認しました。署名鍵は公開テスト用です。[実通信の結果](./transport-results.json)。公開リレーやブラウザーのWebSocketを検証した結果ではありません。

Chromium176項目は実DOM・ネイティブES modulesを使いますが、WebSocket、localStorage、URL履歴、NIP-07、SHA計算にはアダプターを使います。署名済みフィクスチャに対する製品の検証処理を通します。保存試験は `MIKERYAN_TEST_FAST=1`、ほかの画面試験も模擬要求の待ち間隔を無効化しています。製品の間隔は変更しておらず、実際のキュー間隔・制限はNodeの別試験で確認します。

SharedWorkerの故障注入はNodeのMessagePort代替、IndexedDBは最小APIフィクスチャです。実ブラウザーの共有ワーカー・保存許可・タブ間Web Locksの組合せは未検証です。ブラウザーの履歴確認も履歴APIのアダプターであり、ネイティブ履歴の統合確認は未完了です。

`browser_smoke.py` を1.2.3でも実行しましたが、`Page.goto` が `net::ERR_BLOCKED_BY_ADMINISTRATOR` となり、ローカルHTTPページを開けませんでした。[失敗ログ](./native-browser.log)。制限を迂回せず、未通過として記録しています。CSPは静的な記載検査のみで、実HTTP環境での適用確認ではありません。

## 生ログと再現

- [Node全211件の生ログ](./unit-tests.tap)
- [保存画面65項目](./persistence-browser-results.json)
- [欠落回帰34項目](./completeness-browser-results.json)
- [関係表示30項目](./relationships-browser-results.json)
- [追加画面47項目](./audit-browser-results.json)
- [localhost実通信9項目](./transport-results.json)
- [実行手順](./TESTING.md)

Nodeの `--experimental-test-coverage` でも211件が通過しました。[その生出力](./node-coverage.tap) は参考用です。URLクエリ付きのモジュール読込みを含むNode標準の集計で、未読込みのUIモジュールやChromium試験を合算した全体網羅率ではありません。網羅率100%や「未検出の不具合がない」とは主張しません。

`default.json` と `js/feed/moderation.js` とCSS3ファイルは1.2.2とバイト単位で同一です。`default.json` のSHA-256は `7ae5593ca4698c5bc23ce2ef41942c2361e5a7d04b5aa54a058f9441e51fd14f`。設定・接続先・読み取りリレー数の変更によってテストを通したものではありません。

公衆リレーの保持期間・索引・認証制約、実NIP-07拡張、実アカウント、GitHub Pagesの本番配信、他ブラウザー、実端末、長期連続利用は未検証です。全Nostrのデータが入手できることも保証しません。

更新履歴はルートの `CHANGELOG.md` のみです。`relationships-before.tap` は1.2.1での過去試験、`TRAFFIC.md` / `persistence-traffic-results.json` は1.1.1対1.2.0の過去の通信計測であり、今回の成果や削減率としては数えていません。
