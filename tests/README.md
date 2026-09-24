# テストの入口 · 1.2.0

- `npm test`: 現在版のNode単体テスト。
- `python3 tests/browser_persistence.py`: 現在仕様のオフライン画面回帰試験。
- `python3 tests/browser_smoke.py`: 通常のブラウザー環境用の実HTTP・IndexedDB追加試験。今回の環境では管理ポリシーによりページアクセスできず、未通過。

`browser_navigation.py` と `browser_offline.py` のハーネス関数を現在の画面試験でも再利用しています。その直接実行、および `browser_profile.py` の単独実行の期待値は過去版用です。今回実行した画面試験の入口と混同しないでください。

署名鍵・イベントはテスト専用の公開フィクスチャです。実アカウントやウォレットに使わないでください。検証境界と再現方法は `docs/TESTING.md`、現在の通過結果は `docs/TEST_RESULTS.md` にあります。
