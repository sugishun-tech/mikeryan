# Test results: 1.0.1 (2026-09-24)

## Executed

| Check | Result |
| --- | --- |
| Node.js `node --test tests/*.test.js` | 52 passed, 0 failed |
| Official BIP-340 vectors | All 19 included in the 52 tests passed |
| Independent Python/OpenSSL signed Nostr fixtures | All included events verified |
| Corrupted signatures, IDs, tags, timestamps, content, keys | Rejected by tests |
| Relay queue, dedupe, query cache, cooldown, timeout/CLOSE, ACK reuse | Passed mock-socket tests |
| Pagination inclusive boundary, partial-failure cursor, full-delta gap | Passed |
| Metadata batching, persistent-cache abstraction, stale replaceables | Passed |
| Public-key restore, changed account, denied signature | Passed |
| NIP-05 cross-user mismatch, cache, 2-request concurrency, HTTP failures | Passed |
| Strict-mode offline Chromium DOM test | 24 checks passed; no uncaught renderer exceptions |
| Native ES-module profile regression | 14 checks passed; no uncaught exceptions or HTTP requests |
| Offline viewport | 1440×1050 desktop; 390×844 mobile; no horizontal overflow |

Environment: Node.js v22.16.0; Chromium 144.0.7559.96; Python 3.13.

The offline browser harness now retains strict-mode semantics. It uses
deterministic fixture accounts and adapters.
It exercised the actual feature modules and the relay/pool logic with mock
messages, not a live socket or the actual SharedWorker. The SHA-256 adapter
used Python hashlib; the separate Node signature tests used Web Crypto.

## Profile-editor regression

The 1.0.0 failure was reproduced in Chromium with strict-mode execution:
`TypeError: Cannot set property type of #<HTMLTextAreaElement> which has only a getter`.
The original offline test transformation removed ES-module strict behavior and
silently ignored that write, so its passing result did not prove this path worked
in production. The transformation is corrected in this release.

`browser_profile.py` additionally imports native ES modules via Blob URLs and
uses the actual ProfileView edit button, editor, form elements and CSS. Module
and asset URLs are mapped for the empty-document test origin. Repository/social
services are test doubles. It verifies opening, values, close/Escape/reopen,
rejection with preserved edits, Enter submission, URL validation, no duplicate
saves, pending-state controls and mobile scrolling. No external HTTP request
or relay publication occurred. These checks do not validate a real extension.

## Measured in the offline fixture scenario

A guest opens 10 chronological posts from **one** configured mock relay, with
four distinct authors and initially empty caches:

| Action | Additional REQ messages |
| --- | ---: |
| Initial posts + one batched profile fetch | 2 |
| Open one already-known author's posts tab | 1 |
| Return to the previously viewed global timeline | 0 |

The first two finite subscriptions each sent CLOSE at EOSE. No unopened
followers/mutes/relay tab was queried. Counts exclude HTTP identity checks,
profile images, WebSocket framing and TCP/TLS. They are test-case measurements,
not public-network benchmarks or comparisons with the old clients. Different
relay counts, pages, missing metadata and caches change the result.

## Not executed successfully here

The localhost HTTP/WebSocket end-to-end harness could not pass initial browser
navigation because the managed Chromium environment blocked URLs with
`ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was changed. Consequently:

- Actual browser SharedWorker connection sharing and IndexedDB persistence are not verified here.
- Public relay connectivity/acceptance and NIP-05 server interoperability are not verified here.
- Real extension permission UI and key-store behavior are not verified here.
- GitHub Pages deployment and GitHub Actions execution are not verified here.
- Firefox, Safari and mobile-device execution are not verified here.

No real Nostr event was published during testing. The normal-browser local
harness and deployment checklist are supplied for these integration checks.
No third-party security audit was performed.
