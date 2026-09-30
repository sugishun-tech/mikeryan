# Tests · 1.3.2

Current results and limitations: [TEST_RESULTS.md](../docs/TEST_RESULTS.md).
Commands and fixture boundaries: [TESTING.md](../docs/TESTING.md).

```sh
npm run check
npm test
python3 tests/browser_content.py
npm run build
```

The current release passed 310 Node tests and 118 native-DOM content checks.
`x-links.test.js` covers link-only X/Twitter handling, mixed content, imeta,
remaining direct media support, removed assets, CSP and release versions.
The browser content suite checks that X links allocate no embed or iframe,
without a mocked X provider. It retains the other rich-content regression tests.
Images, YouTube messages, relay traffic, storage and navigation use explicit
fixtures. These results do not establish live YouTube playback or production
HTTP CSP behavior. Other retained browser suites were not rerun for this release.

All signer keys and events are deliberately public test fixtures. Never use
these accounts for real posts or wallets. Change history lives in CHANGELOG.md.
