# Testing

## Dependency-free Node tests

```sh
npm run check
npm test
npm run build
```

Requires Node.js 20+. No npm dependencies. Fixture JSON is already included.
The application and test sources use ES modules. The workflow runs these
checks before publishing the static allowlist to `dist/`.

`crypto.test.js` includes all 19 official BIP-340 verification vectors and
independently signed Nostr events. `network.test.js` uses a mock socket to
exercise the real relay connection/pool. `core.test.js` covers identity,
routing, settings, account restoration, metadata caches and pagination.

## Browser tests with localhost WebSockets

Optional development environment, not an application runtime requirement:

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install playwright websockets cryptography
# Install Chromium using your operating system package manager,
# or install the Playwright-managed browser with: playwright install chromium
python tests/browser_smoke.py
```

`CHROMIUM_PATH` can override the executable. The test starts an ephemeral HTTP
server and local WebSocket relay and generates example events. NIP-07 and
NIP-05 are test doubles; browser WebSocket, SharedWorker and IndexedDB paths
are real in this harness. No public relay is used and no user account is
needed. The test expects one relay connection across two tabs and no extra
REQ when reopening the cached timeline. Results go into `tests/output/`.

This real-network harness was supplied but did not complete in the packaging
environment: Chromium's managed URL policy denied the initial localhost
navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). Its browser-integration assertions
must not be cited as passed. The policy was not disabled or changed.

## Browser DOM tests without URL access

```sh
python tests/browser_offline.py
```

This harness uses Chromium's empty document and injects source modules into
isolated strict-mode test closures. Strict mode is required: native ES modules
throw on writes to read-only DOM properties, whereas a non-strict closure may
silently ignore the same bug. It supplies test-only transport, localStorage,
navigation and SHA-256 adapters. It does not navigate or make network requests.
The source transformation is only test infrastructure, not the deployment
build. It leaves the production files and their CSP unchanged.

It verifies posting, replies, likes, login restoration, follow changes,
mutual badges, current follower validation, public mute/relay lists, profile
editing, notifications, settings and responsive layout. Screenshots and
`offline-browser-results.json` are written to `tests/output/`. All identities,
keys, posts and signatures are generated test fixtures, not real users.

A passing offline harness does not validate native browser IndexedDB,
SharedWorker, Web Crypto, origin/CSP loading, extension interoperability or
hosting. Node's independent cryptographic tests use actual Web Crypto SHA-256.
These distinctions are intentional and recorded in TEST_RESULTS.md.

## Native-module profile regression tests

```sh
python tests/browser_profile.py
```

This test imports the actual modules through Blob URLs in Chromium. Relative
imports and asset/import.meta URLs are mapped for the empty-document origin;
JavaScript runs as native ES modules, not as flattened non-strict script.
No browser policy is changed and the deployed CSP remains unchanged. The page
uses the actual profile edit button, dialog, form elements and CSS. Repository
and social services are test doubles, so it does not publish a real event.

It checks the original read-only textarea property error, populated fields,
no service reads on opening, close/Escape/reopen, rejection with retained input,
Enter submission, URL validation, duplicate-submit prevention, pending-save
controls, narrow-screen scrolling and the removal of promotional headings.
Results are written to `tests/output/profile-editor-results.json`.

## Normal-browser release checklist

Use the same deployment origin you intend to keep, start with one or two
known relays, and inspect the settings diagnostic counters. Check the
following manually before relying on a newly deployed build:

- Root and project-subpath URLs, browser Back, legacy query links, and reload.
- Real extension login; reload without login; approved/denied signatures and account changes.
- Two same-origin tabs report SharedWorker mode with no duplicate connection.
  If the browser does not support it, verify the documented per-tab fallback.
- IndexedDB survives reload and its absence does not prevent read-only UI.
- Valid/mismatched/unreachable NIP-05 domains and missing profile fields.
- Relay OK/EOSE behavior, paid/auth-required relay consent, disconnects and cooldowns.
- A partial write creates a retryable outbox item rather than silently reporting total failure/success.
- Muted timelines, explicit profile posts, mobile search and large same-second history pages.

The test account keys are public. Never fund them or reuse them for a real
identity. The static build excludes all test signing code and fixtures.
