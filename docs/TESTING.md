# Tests · 1.1.1

## Node checks

```sh
npm run check
npm test
npm run build
```

Node.js 20+ is needed; no npm dependencies are required. Tests cover filter/routing validation, BIP-340 verification, NIP-05, auth, repository behavior, socket queues, close/backoff behavior, and 30-row viewport-anchor paging. Fake-relay tests exercise newest-first ordering, sparse and saturated periods, same-second ties, partial failure, concurrency coalescing, and fresh repeated post/like reads. traffic.test.js also checks a real signed 30-author batch, known-author exclusion, fresh/all/required reads, per-relay repair under silent caps, no repair after failure, no negative or malformed success caching, and session/scope transitions.

## Offline browser tests

```sh
python -m pip install playwright cryptography websockets
# Install or specify Chromium in a normal environment.
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_navigation.py
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_profile.py
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_offline.py
```

`browser_navigation.py` loads actual native ES modules through Blob URLs and uses real browser DOM/layout. Transport, local storage, navigation, URL loading and Web Crypto digest are adapted for a network-restricted environment. It checks the three button labels and limits, actual viewport anchors, no scroll-triggered relay REQ, nearest-above insertion, scroll preservation, fresh post reads, session-profile reuse, explicit profile refresh, automatic own-reaction reads, and desktop/mobile/profile scrolling. Tests use widths 1440, 390 and 320 pixels.

`browser_profile.py` tests native module strict-mode behavior and real input controls through the actual profile-edit button, with repository/social services adapted. It covers the textarea type regression, open/close/Escape, fields, save/errors/retry, duplicate submission and mobile fitting.

`browser_offline.py` is the broader behavior regression. It runs module code inside isolated strict closures and uses fake relay/storage/navigation/digest adapters and removes inter-request delays only in the test-loaded transport. Queue timing is covered by the Node transport suite. It covers login restoration, posts/replies/likes, follow/mutual/list behavior, profile editing and themes. It is not a native network integration test.

Results and screenshots go to `tests/output/`. Test accounts are deterministic public fixtures, not real accounts. Do not use or fund them.

## Actual integration in a normal browser environment

```sh
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py
```

This separate test starts localhost HTTP/WebSocket servers and exercises actual script URLs, storage and SharedWorker. The execution environment used for this release blocked localhost URL navigation, so this integration test was not completed here. Do not treat its presence as a passing result.

Before production use, verify the unmodified site in Firefox and Chromium with an actual NIP-07 extension, configured public relays, GitHub Pages subpath hosting, and two tabs. Check the WebSocket log for finite REQ/EOSE/CLOSE and new REQ after a completed identical read. On a reloaded tab, verify restored login UI without an automatic signature prompt. No real extension, public relay, Firefox or hosted Pages integration was verified for this release.

## Wire counter benchmark

```sh
npm run benchmark
# Compare directly with an unpacked, unmodified 1.1.0 directory:
node scripts/benchmark.mjs --baseline ../mikeryan-1.1.0/mikeryan
```

The optional baseline is not bundled or downloaded automatically. Use the previously supplied ZIP. Output defaults to docs/traffic-results.json; `--output /path/result.json` chooses another path. `scripts/traffic-fixtures.py` regenerates deterministic signed public test events using the test-only signer. The benchmark enables production signature verification, uses two fixture relay connections, and counts actual serialized REQ/CLOSE and EVENT/EOSE messages. It does not contact public relays or measure server load. See TRAFFIC.md for conditions.
