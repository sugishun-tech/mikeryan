# Tests · 1.3.3

Current results and limitations: [TEST_RESULTS.md](../docs/TEST_RESULTS.md).
Commands and fixture boundaries: [TESTING.md](../docs/TESTING.md).

```sh
npm run check
npm test
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_content.py
npm run build
```

The current release passed 335 Node tests and 152 native-DOM/browser checks.
`ui-depth.test.js` covers the Japanese display name, stable storage namespace,
removal of the right search form, retained mobile search, two nested levels,
and the unchanged single direct slot per post. `browser_content.py` exercises
the real rendering classes, including nested images, videos, Nostr references,
quotes, reposts, failure links, cycles and responsive layouts.

Relay traffic, images, YouTube messages, storage, navigation and SHA use explicit
fixtures. The normal local-HTTP startup attempt was blocked before app execution
by the environment (ERR_BLOCKED_BY_ADMINISTRATOR). These results do not establish
live relay access, YouTube playback, or production HTTP CSP behavior. Other
retained browser suites were not rerun for this release.

All signer keys and events are deliberately public test fixtures. Never use
these accounts for real posts or wallets. Change history lives in CHANGELOG.md.
