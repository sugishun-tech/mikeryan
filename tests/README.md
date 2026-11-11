# Tests · 1.3.5

Current results and limits: [TEST_RESULTS.md](../docs/TEST_RESULTS.md).
Commands and fixtures: [TESTING.md](../docs/TESTING.md).

```sh
npm run check
npm test
npm run build
node --test tests/reaction-replies.test.js
```

Run the production-module tests for notification-only reaction replies alongside
the existing post actions, media, account, storage and transport regressions.
Check target ownership and NIP-25 tags, already-liked state, repeated clicks,
cross-tab exclusion, reload persistence, incomplete reads, failed persistence,
same-event retries and account changes. Generic reaction sending and legacy
post-like retries must remain blocked. Component tests use a deliberately narrow
DOM/event fixture; they do not establish browser layout or live-provider behavior.

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_reaction_replies.py
```

Record only tests actually executed in TEST_RESULTS.md. A failed browser launch
is not a browser pass; old reports remain historical. All keys and signed events
are public test fixtures. Do not use real accounts, publish to public relays or
use fixture accounts for real posts or wallets.
