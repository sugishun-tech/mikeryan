# Test results — 2026-09-24

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
| Offline Chromium DOM test | 24 checks passed; no uncaught renderer exceptions |
| Offline viewport | 1440×1050 desktop; 390×844 mobile; no horizontal overflow |

Environment: Node.js v22.16.0; Chromium 144.0.7559.96; Python 3.13.

The offline browser harness uses deterministic fixture accounts and adapters.
It exercised the actual feature modules and the relay/pool logic with mock
messages, not a live socket or the actual SharedWorker. The SHA-256 adapter
used Python hashlib; the separate Node signature tests used Web Crypto.

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
