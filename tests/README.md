# Tests · 1.3.4

Current results and limits: [TEST_RESULTS.md](../docs/TEST_RESULTS.md).
Commands and fixtures: [TESTING.md](../docs/TESTING.md).

```sh
npm run check
npm test
npm run build
```

349 Node tests passed. Added regression coverage runs actual production modules
for repeated media across posts, removed post actions, preserved inbound reaction
notifications, blocked reaction signing/sending/retry, and hidden legacy reaction
outbox entries. Component tests use a deliberately narrow DOM/event fixture;
they do not claim browser layout or live external-provider compatibility.

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
```

Browser assertions were updated, but Chromium could not start in this environment
because its socket operation was denied. No current browser pass count is claimed.
Old browser reports remain historical. All keys and signed events are public test
fixtures; never use these accounts for real posts or wallets.
