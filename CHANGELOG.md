# Changelog

## 1.2.0 (2026-09-24)

- プロフィールkind:0とそのNIP-05検証結果だけを専用ストアへ永続保存。IndexedDBを優先し、利用不能時はlocalStorageへ切替。
- TTL・背景更新なし。プロフィールの明示更新まで保存内容を使い、全表示箇所・再起動・ログアウト・リレー設定変更後にも再利用。
- ページアクセス・ログイン時の投稿／リスト自動取得を停止。全ページで明示ボタンから取得。3ボタン・30件・現在位置基準は保持。
- 自分のNIP-65公開リレーの追加／削除と用途指定を追加。最新読み取り後の差分更新、未知タグ・他のURLを保持。接続先設定は非変更。
- 取得済みリストと投稿は永続保存せず、画面遷移時の自分のリストも消去。設定・ログイン・下書き・未達送信は従来どおり。
- 単体112件、現在仕様の画面65項目、1.1.1との再起動を含む4条件の通信比較を追加。実IndexedDB/SharedWorker等の未検証境界を明記。
- 全JS/CSS/SharedWorkerを1.2.0へ更新。旧リリースの計測はdocs/historyへ移動。

以下は当時の仕様の記録で、現在版の保存方針ではありません。

## 1.1.1 (2026-09-24)

- Replace per-author kind-0 filters with bounded authors-list batches and share the REQ with page-scoped own reactions.
- Share the repository's pending metadata work across feed/profile/list paths; query only unknown authors.
- Retain successful, valid profiles in tab memory only. Reload/logout/account changes clear reuse; changed relay scope, explicit refresh and read-before-write bypass it. No fetched data is persisted.
- Repair missing profiles on the affected relay only, once, without resending reactions or already returned authors. Stop after refusal/timeout; no retry loop or negative-result caching.
- Keep the three viewport-anchored 30-post buttons and all existing UI/removal choices unchanged.
- Keep each post/like read fresh; preserve full latest-state verification before profile/follow writes.
- Add signed 30-author wire-count benchmarks against the unchanged 1.1.0 source and failure/scope/refresh regressions. See docs/TEST_RESULTS.md and docs/TRAFFIC.md for measured results and unverified integration boundaries.
- Version all JS module imports, entry CSS and SharedWorker as 1.1.1; storage/default settings stay unchanged.

## 1.1.0 (2026-09-24)

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
