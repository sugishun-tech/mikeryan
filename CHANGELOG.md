# Changelog

## 1.3.2 · 2026-09-30

- Remove X/Twitter card embedding, provider script loading, iframe bridge, dedicated CSS and diagnostics. X/Twitter page URLs remain ordinary links with their original spelling.
- Do not reserve a rich-content slot for X/Twitter links, including imeta overrides. Later image, NIP-21, YouTube or q references remain eligible under the existing one-slot policy. Direct media hosts such as pbs.twimg.com still support image rendering.
- Remove obsolete X embed tests and replace them with ordinary-link, no-widget/no-frame, mixed-content and depth regressions. Preserve the other content tests.
- Remove the same-origin frame CSP allowance used by the deleted bridge; retain the YouTube player origin. Refresh entry assets, module imports and SharedWorker version to 1.3.2.
- Preserve default.json, moderation, accounts, storage formats, relays and all other features. See docs/MIGRATION.md for files to remove when copying over an older deployment.

## 1.3.1 · 2026-09-30

### X embedded posts

- Load the official `platform.x.com/widgets.js` endpoint; permit both X/Twitter platform and syndication hosts in the isolated child CSP.
- Install and wait for `twttr.ready` before invoking the factory once. Do not confuse script load with API readiness.
- Measure the returned element rather than requiring an iframe in its light DOM. Wait for nonzero height with a deadline, handle missing ResizeObserver, and ignore unrelated global errors.
- Retain ordinary links on failure, source/origin/token validation, opaque sandbox isolation, duplicate suppression and one-slot/depth-one limits. Reject invalid readiness heights.
- Accept the documented 220px minimum; recognize status URLs with photo/video suffixes. Version the bridge URL and static modules as 1.3.1.
- Add `docs/x-embed-check.html`, using the production renderer without account, mute, relay or storage access. No external request before explicit submission.
- Tests executed: Node 295 passed; content DOM 103, X bridge/CSP 31, diagnostic UI 8 passed. The same X suite against 1.3.0 failed 16 of 31 checks.
- Live unadapted browser test attempted but blocked by `ERR_BLOCKED_BY_ADMINISTRATOR` before navigation. Real X rendering is **not verified**; mock success is not counted as live success. See `docs/TEST_RESULTS.md`.
- Keep default.json, persisted settings and account state unchanged.

## 1.3.0 (2026-09-30)

### 投稿本文・埋め込み

- NIP-21のnote / nevent / npub / nprofile / naddrを解析し、既存の投稿・プロフィールカードで表示。naddrのkind・公開鍵・識別子に一致する最新版を照会し、専用のハッシュルートを追加。
- **1投稿につき全種類合計で最大1件。** 本文で最初に出現する対応候補を採用。NIP-21候補は最初のURIだけで、2件目以降もクリック可能なリンクとして残す。候補が取得に失敗しても後続候補を連鎖取得しない。本文に候補がなければqタグの最初の引用を表示。
- 埋め込み内のNostr参照・画像・X・YouTube・再リポストを展開しない。リポストの元投稿も1枠を消費。循環・破損・未取得・個別の例外で一覧全体を止めず、説明とリンクを残す。
- HTTPS画像のJPEG/PNG/WebP/GIF/AVIF/APNG/BMP、URLクエリ、NIP-92 imetaのurl/m/dim/altに対応。拡張子なしでも本文URLと対応するMIMEがあれば表示。lazy loading、縦横比維持、幅100%・高さ520px上限、エラー時のリンク表示を追加。
- X/Twitterのstatus URLはローカルの不透明オリジンsandbox内で公式widgetsを実行。親画面・設定・NIP-07へアクセスさせず、作成拒否・スクリプト失敗・CSP・タイムアウト時はリンクへ戻す。狭すぎる画面もリンク表示。
- YouTubeのwatch / youtu.be / shortsを許可リストで判定し、youtube-nocookie.comのiframeをレスポンシブ表示。親に外部スクリプトを追加せず、プレイヤー通知の互換ハンドシェイクと期限で成功・失敗を判定する。公開IFrame JavaScript APIそのものではなく、実サービスのプロトコル変更時もリンクへ戻る。他の動画サイトはiframe化しない。

### リポスト・引用・通信

- kind:6 / kind:16をフィードとプロフィール投稿の取得対象に追加。リポスト者を元投稿の上に表示。contentの元JSONはIDと署名も検証し、なりすましJSONを信用しない。空・破損の場合はe / aタグで取得し、kind / k指定も確認。
- qタグを引用として明示し、旧形式のeタグが併記されても引用だけなら返信扱いにしない。本当の返信との併用は維持。
- 画面と設定リレー範囲内で重複参照を共有。メモは最大512件、永続保存なし。同じ外部メディアは現在画面内で1回だけ初期化し、ほかはリンク。長文は約64,000文字・128リンクごとの置換式表示にしてDOMの自動増殖を抑える。
- 画面遷移・要素削除でタイマー、Observerの監視対象、メッセージリスナー、プレイヤーを片付ける。選択外のリレーヒントへ自動接続しない。自動タイムライン取得なし、3ボタン・最大30件、プロフィール専用永続保存を維持。
- default.json、既存ミュート規則、保存形式は変更しない。初期設定のhttps / nostr\:ミュートに合致した投稿は引き続き非表示になる。表示したい利用者は設定で該当パターンを削除し、画像表示を有効にする。

### 検証と配布

Node **281件**、Chromium **275項目**（既存176 + 新規99）、localhost実WebSocket **9項目**が通過。新規70件の解析・取得試験と99項目のDOM試験、結果JSONを同梱。X sandboxの親DOM・NIP-07遮断は実ブラウザーで確認したが、外部サービス、CSPの本番適用、実拡張・公衆リレーは未検証。画面試験では外部画像・X widgets・YouTube通知を模擬する。詳細はdocs/TEST_RESULTS.md。

JS/CSS/SharedWorkerの版を1.3.0に統一。全体を更新し、特に新規js/content/、js/ui/embeds.js、assets/embeds/を欠落させない。変更履歴はこのファイルへ集約。

## 1.2.3 (2026-09-29)

### 原因の補足

直前に報告されたフォロワー欠落は、ユーザーの確認により、旧mynostr_profileと今回のクライアントで設定したリレーが異なっていたことが原因と判明した。このリリースは、その接続先の相違とは別に、1.2.2へ遅延・失敗・同時操作を注入して再現した問題を修正する。接続先と読み取りリレー数は変更しない。

### アカウントと書き込み

- ログイン・ログアウトの世代を管理し、遅れて返ったログインでログアウトや新しいログインを取り消さない。同じ鍵へ再ログインしても、古い署名待ち操作は無効にする。
- 署名内容を操作開始時にコピーし、キュー待ち・拡張機能待ち・署名検証後にアカウントの一致を再確認する。フォロー・プロフィール・公開リレー編集の読み取り待ちにアカウントが変わった場合は、署名前に中止する。
- フォロー、プロフィール、公開リレーの更新は、全設定リレーへの再確認を維持しながら、現在画面で受信済みの新しい署名付き状態も比較する。空・古い応答による巻き戻りを防ぐ。不正な最新プロフィールJSONは空オブジェクトへ変換せず、上書きを中止する。
- プロフィール編集は実際に変更した項目だけを最新状態へ適用する。未編集項目・未知の項目を保持し、変更がない保存では署名しない。kind:0がまだないアカウントも初回作成できる。アカウント切替時は前のアカウントの編集画面を閉じる。

### 下書き・送信・保存

- 投稿中に書き始めた次の下書きを、先の投稿完了で消さない。画面・アカウントが変わった後に返る投稿結果を、新しい画面へ挿入しない。
- 署名済みイベントを通信に渡す前にoutboxへ登録する。通信処理の例外でも同じイベントを再送できる状態を保つ。同時送信の保存更新を直列化し、一方の未達イベントを消さない。同じイベントの同時再送をまとめ、受理済みの応答を保持する。
- outboxの保存失敗を通知し、保存できたとは表示しない。失敗した書き込みの新しいメモリ状態を古いディスク値で戻さず、通常時は別タブの削除を尊重する。Web Locks利用可能時はoutbox更新にもタブ間ロックを使う。実ブラウザーでのタブ間ロック統合試験は未実施。
- プロフィール保存の容量不足時にも、そのタブでは選択済みの新しいレコードを保持する。永続保存の失敗は警告し、再起動後も保存されるとは扱わない。

### 取得・画面・通信

- 投稿IDのまとめ読みを画面世代とリレー範囲で分離する。古い画面のキューを新画面で実行・保持しない。取得失敗を「存在しない投稿」と誤表示しない。
- スレッドの本文・親情報を準備してから表示を置き換える。更新失敗で既存本文と返信下書きを消さない。
- フォロワー更新で全探索経路が失敗した場合、以前の一覧と取得状態を維持する。古い相互関係から再構成できた一部の人だけへ縮めない。再試行は明示操作のみ。
- 相対ハッシュリンクでのタブ移動も履歴へ記録し、戻る・進む・再読み込み後の戻るを修正する。遅れた古いWebSocketのcloseが新しい接続の要求を終了しないよう分離する。
- 最新の置換可能イベントを直接確認する際の不正署名・不正形式を、正常な空リストとして確定しない。
- SharedWorkerの送信例外・停止・応答復号エラーで待ち要求とタイマーを終了する。以降の明示操作はタブ内プールを使用できる。既に送信された可能性のあるイベントを自動再送しない。
- 設定JSONの配列・真偽値・数値の型を検証する。不正なインポートで設定を置き換えない。旧設定の移行時に保存権限がなくても起動を中断せず、タブ内の設定と警告を表示する。

### 維持する仕様

`default.json`、ミュート判定、CSSは1.2.2とバイト単位で同一。自動取得なし、上下・最新の3ボタン、1操作で新たに表示する件数は最大30件、取得データの永続保存はkind:0プロフィールとそのNIP-05検証情報のみ、という仕様を維持する。設定・ログイン・下書き・outboxの保存キーと形式は変更しない。

### 検証と配置

Node 211件、Chromium 176項目（65 + 34 + 30 + 47）、ローカルの実WebSocket通信9項目が通過。ページングは追加2テスト内で各100通りの生成データを確認した。追加回帰47件を1.2.2で実行し、39件の失敗を確認した。画面の追加試験でも旧版で14項目が失敗する。これらは複数の確認項目を含み、不具合の個数を表す数字ではない。結果・生ログ・検証範囲は `docs/TEST_RESULTS.md`。

公衆リレー、実アカウント、実NIP-07拡張、実IndexedDB・SharedWorkerを含むブラウザー統合は未検証。ネイティブのブラウザー試験は、この実行環境のURLアクセス制限により開始できず、合格に数えていない。全状態の網羅率100%や、全Nostrで欠落がないことを保証するものではない。

全体ZIPの `mikeryan/` 内をまとめて更新する。JS参照・入口・SharedWorkerの版を1.2.3へ統一した。独自の `default.json` は保持し、古いタブを閉じて強制再読み込みする。サイトデータの削除は不要。更新履歴はこの `CHANGELOG.md` だけに追記し、UPDATEファイルは追加していない。

## 1.2.2 (2026-09-29)

### フォロワー欠落・相互表示の再修正

1.2.1ではフォロワー欠落と相互表示の問題が残っていた。今回、旧版で失敗する4つの具体的な回帰テストを先に作成し、以下の経路を修正した。以前の「欠落防止」の記載は全リレー・実アカウントでの完全性を意味しない。

- 逆引き候補の署名付きkind:3を捨てて直接照会だけで判定していた処理を修正。候補検索・直接照会・現在画面で確認済みのイベントを比較し、作成時刻と同時刻のID順で最新状態を選ぶ。空・古い応答で新しいフォローを消さず、より新しい署名付き解除では正しく除外する。
- 複数著者のkind:3照会が全件空の場合にも、不足著者を一度ずつ単独照会する。一つの空応答から全員を非フォローと推定しない。プロフィール用の空応答最適化とは分離する。
- フォロー状態を「肯定・否定・未確認」に分離。個人単位で照会を集約し、一人の照会失敗で全員の行・相互バッジを失わせない。署名付きフォロー証拠のある人は警告を付けて保持し、証拠のない候補も永久除外せず明示再確認を可能にする。
- フォロワーの候補検索をリレー別の独立カーソルへ変更。失敗したリレーの位置を進めず、健康なリレーで確認できた人物は表示する。境界確認中の失敗でも先に取得したイベントをpartialへ引き継ぐ。
- 本人のフォロー先を最大30人ずつ直接確認し、逆引き索引で漏れた相互フォローを補う。表示待ちの候補を公開鍵で重複排除し、1操作で新たに表示する人数は最大30人とする。表示待ちの間に新しい解除が確認された人物も除外する。
- 本人だけでなく相手のkind:3更新でも既存の相互バッジを再描画する。相互関係の証拠がない場合は「相互未確認」と表示する。
- 未確認候補の再試行は「未確認の候補を再確認」。再試行で別ページへ飛ばず、30人ずつ未確認状態を確認する。保存済みプロフィールの強制更新方針、ミュート判定、default.json、選択済み読み取りリレー、公開リレー編集・署名・保存形式は変更しない。新たなリレー接続先・自動取得・リスト永続キャッシュは追加しない。

### 配置

全体ZIPの `mikeryan/` 内をまとめて更新する。新規 `js/social/followers.js` を必ず含める。入口・JS・CSS・SharedWorkerの参照を1.2.2へ統一した。独自の `default.json` は保持し、更新後は強制再読み込みする。サイトデータの削除は不要。UPDATEファイルは追加していない。

### 検証と限界

Node 162件通過（今回の関係・フォロワー回帰29件を含む）。Chromiumは保存・既存動作65項目、欠落回帰34項目、今回の相互表示・通信条件30項目、合計129項目通過。旧版で4件失敗する生ログと、現行版の結果を `docs/TEST_RESULTS.md` から確認できる。

画面試験は署名済み公開テストフィクスチャと模擬WebSocketを使う。保存試験は `MIKERYAN_TEST_FAST=1` で要求間隔を無効化し、実際の間隔・拒否時の制御はNode試験で別途検証した。公衆リレー・ユーザーの実アカウント・実NIP-07拡張・実配信環境との照合は未実施。設定中の読み取りリレーで入手できないイベントや、検出できない索引欠落を全Nostrから回収する保証はしない。照会は設定中のリレーだけを使い、今回の回復確認に伴うREQ増加を旧版の通信削減率と混同しない。

## 1.2.1 (2026-09-29)

### 修正

- 投稿・通知・フォロワー候補をリレー別／フィルタ別に取得し、合算件数による誤った終端・飽和判定を修正。少件数応答の古い側を確認し、読み取り済みの共通境界だけを採用する。見つかった同秒上限を飛ばさず、上下の探索状態を次の手動操作へ引き継ぐ。
- 非空の部分応答でも、失敗した「最新」で既存一覧を消したり取得位置を進めたりしない。表示準備の失敗時はページ状態を戻す。プロフィール取得の失敗を、既存の表示条件で隠してよいユーザーと誤認しない。
- フォロー・公開ミュートのユーザー行を、名前と相互フォローの取得より先に表示する。補助情報の失敗でユーザーを省略せず、未確認表示と再取得ボタンを追加する。保存済みプロフィールの強制更新方針は変更しない。
- フォロワーの最新フォロー状態を確認できなかった場合、同じ候補ページを保留して再確認する。再試行で次のページへ飛ぶ問題を修正。解除済みの古い候補は引き続き最新kind:3で除外する。
- 最新プロフィール・フォロー・公開ミュート・公開リレーの複数ユーザー取得を整備。リレーが複数条件を一部しか処理しない場合は不足者だけを単独条件で確認する。再試行段数と要求間隔を制限し、拒否後の自動ループは作らない。
- 大きい公開リストを一般投稿の256KiB制限で捨てないよう、kind:3 / 10000 / 10002の上限を4MiB・50,000タグ、受信フレームを8MiBとする。通常投稿の上限は変更しない。超過は空リストではなく取得失敗として表示する。
- 署名検証中の例外でもREQを確実に終了し、未完了と成功を区別する。一覧の更新・次ページ処理の競合を抑止し、処理中の状態を表示する。
- ミュート判定・default.json・読み取りリレー数・接続先・ログイン／設定／下書き／保存形式は変更しない。自動取得なし、1操作最大30件、プロフィールのみ永続保存を維持する。

### 更新と履歴の統合

全体ZIPの `mikeryan/` 内を既存プロジェクトの同じ位置へ配置する。新規 `js/network/page.js` を含め、依存JS・入口CSS・SharedWorkerを1.2.1でそろえる。独自の `default.json` は保護する。更新後は強制再読み込みし、サイトデータは消去しない。

既存の `UPDATE-1.1.0.txt`、`UPDATE-1.1.1.txt`、`UPDATE-1.1.1-files.json`、`UPDATE-1.2.0.txt`、`UPDATE-1.2.0-files.json` を配布物から削除し、更新履歴と移行上の注意はこのファイルへ統合した。上書き配置だけでは旧UPDATEファイルは削除されないため、既存リポジトリに残っている場合は上記5ファイルを削除する。新しいUPDATEファイル・変更ファイル一覧マニフェストは作らない。

### 検証

Node 133件（今回の欠落回帰21件を含む）、Chromium画面65項目＋欠落回帰33項目。実行範囲・生ログ・未検証の境界は `docs/TEST_RESULTS.md`。公衆リレー・実アカウント・実NIP-07拡張・本番配信での完全性は保証しない。通信比較表は1.2.0の過去計測として区別する。

## 1.2.0 (2026-09-24)

更新時は新規 `js/profiles/cache.js`、`relay-list.js`、`relays-view.js` を含めて配置する。1.1.1以前のメモリ上のプロフィールは移せず、この版で初めて取得した人から永続保存が始まる。公開リレーの編集と接続先設定は別であり、サイトデータの消去は不要。旧1.1.1計測は `docs/history/1.1.1/` に保存。

- プロフィールkind:0とそのNIP-05検証結果だけを専用ストアへ永続保存。IndexedDBを優先し、利用不能時はlocalStorageへ切替。
- TTL・背景更新なし。プロフィールの明示更新まで保存内容を使い、全表示箇所・再起動・ログアウト・リレー設定変更後にも再利用。
- ページアクセス・ログイン時の投稿／リスト自動取得を停止。全ページで明示ボタンから取得。3ボタン・30件・現在位置基準は保持。
- 自分のNIP-65公開リレーの追加／削除と用途指定を追加。最新読み取り後の差分更新、未知タグ・他のURLを保持。接続先設定は非変更。
- 取得済みリストと投稿は永続保存せず、画面遷移時の自分のリストも消去。設定・ログイン・下書き・未達送信は従来どおり。
- 単体112件、現在仕様の画面65項目、1.1.1との再起動を含む4条件の通信比較を追加。実IndexedDB/SharedWorker等の未検証境界を明記。
- 全JS/CSS/SharedWorkerを1.2.0へ更新。旧リリースの計測はdocs/historyへ移動。

以下は当時の仕様の記録で、現在版の保存方針ではありません。

## 1.1.1 (2026-09-24)

更新時の新規必須モジュールは `js/network/profile-batch.js`。全体版は新規配置可能、当時の差分ZIP単体では起動しない。独自のdefault.jsonとログイン・設定・下書きを保持し、関連モジュールを一括配置する。

- Replace per-author kind-0 filters with bounded authors-list batches and share the REQ with page-scoped own reactions.
- Share the repository's pending metadata work across feed/profile/list paths; query only unknown authors.
- Retain successful, valid profiles in tab memory only. Reload/logout/account changes clear reuse; changed relay scope, explicit refresh and read-before-write bypass it. No fetched data is persisted.
- Repair missing profiles on the affected relay only, once, without resending reactions or already returned authors. Stop after refusal/timeout; no retry loop or negative-result caching.
- Keep the three viewport-anchored 30-post buttons and all existing UI/removal choices unchanged.
- Keep each post/like read fresh; preserve full latest-state verification before profile/follow writes.
- Add signed 30-author wire-count benchmarks against the unchanged 1.1.0 source and failure/scope/refresh regressions. See docs/TEST_RESULTS.md and docs/TRAFFIC.md for measured results and unverified integration boundaries.
- Version all JS module imports, entry CSS and SharedWorker as 1.1.1; storage/default settings stay unchanged.

## 1.1.0 (2026-09-24)

1.0系のIndexedDBは使用も自動削除もしない。旧DBに未完了送信が残る場合は旧版で処理してから更新する。1.1系以降の未完了送信はlocalStorageで管理。HTMLが古い場合は強制再読み込みし、サイトデータは消去しない。

- Restore the three manual controls: 下に読み込む, 上に読み込む, 最新を読み込む.
- Use actual visible post anchors; reflect at most 30 posts per action.
- Keep controls sticky on desktop/mobile and preserve reading position on insertion.
- Bound nearest-newer searches and retain only scalar continuation cursors.
- Remove fetched-data/response caches, IndexedDB access, old timeline controls, and the right-side network card.
- Fetch only the selected page, batch names and own reactions, share active connections and concurrent identical requests, and close finite subscriptions at EOSE.
- Keep public-key login, settings, drafts, and authored pending sends.
- Remove duplicate refresh requests and version all JS imports/CSS/SharedWorker.
- Add viewport/no-cache browser regressions. See docs/TEST_RESULTS.md for executed tests and limitations.

Earlier entries below describe their historical releases, not the current cache/UI behavior.

## 1.0.1 (2026-09-24)

### Profile editor

- Fix the profile button failing before the dialog opens: `textarea.type` is
  read-only, and assigning to it throws in an ES module. Only `input` elements
  now receive a `type` property.
- Move the editor into `js/profiles/editor.js`. Keep the existing export from
  `profiles/view.js` and wrap the opening action in the normal error handler.
- Submit through the form handler, including Enter in a single-line field.
  Do not use `method="dialog"`, which can dismiss a form without saving it.
- Show rejected or failed saves inside the modal, preserve the entered values,
  and allow retrying. Disable duplicate submissions and dismissal during a save.
- Retain existing profile fields, signing and relay publication behavior.
  Opening the editor performs no additional relay query.

### Interface

- Remove the header slogan, the promotional sidebar card and footer slogan.
- Use a single-line header and the functional heading "通信状況".
- Remove promotional headings from the documentation and use a plain login prompt.
- Keep search, relay counters, settings, navigation and help links.

### Tests

- Correct the offline browser harness to preserve ES-module strict behavior.
  Its old non-strict transformation silently ignored the invalid property write,
  which is why the 1.0.0 profile-edit test did not catch this defect.
- Add `tests/browser_profile.py`: native ES modules loaded through local Blob
  URLs, native browser form controls and the actual ProfileView button. Only
  module/asset URLs and repository/social services are adapted for the test.
- Re-run 52 Node unit tests, 24 strict-mode offline browser checks and 14 native
  module/profile regression checks. All pass in Chromium.
- Real extensions, public relay acceptance, Firefox and production hosting remain
  unverified. No real account was accessed and no public event was published.

### Updating

Copy the contents of `mikeryan/` over the existing project and redeploy.
The changes-only archive contains changed/new files with the same directory
layout. It is not a standalone application. Neither archive deletes files.

The new `js/profiles/editor.js` must be deployed together with `view.js`.
`default.json`, relay settings, storage key prefixes and the login persistence
format are unchanged. Preserve any deployment-specific changes to `default.json`.
After deployment, reload the page without using the old cached scripts. Browser
storage does not need to be cleared.
