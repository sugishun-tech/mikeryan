# Security and privacy

## Secret keys and permissions

Production application code has no private-key signer, secret import or key
export. NIP-07 performs signing. Only a public key is persisted for restoring
the account UI. This is not a server session or proof that an extension is
currently unlocked. At the first restored write the current extension key is
checked; signed template data and event signatures are checked every time.

The application does not suppress extension approval prompts. Grant signing
permission only to a deployment you trust. Log out and clear browser site
data on shared devices when local drafts or saved account settings matter.

## Cryptography boundary

`js/core/crypto.js` is an independently implemented public-data-only BIP-340
verifier using BigInt point arithmetic and Web Crypto SHA-256. All 19 official
verification vectors pass, including invalid curves, infinite points,
noncanonical scalars and variable message lengths. Independently produced
Python/OpenSSL Nostr fixtures also verify, and altered event data is rejected.

These tests are NOT a third-party cryptographic audit or a proof of no bugs.
Point operations are not constant-time and must NEVER be reused for private
keys. NIP-07 is the only production signing path. Audited-library substitution
is possible behind `verifyEvent()` / `verifySchnorr()`; keep the API and tests.

`tests/fixture_signer.py` contains deliberately public deterministic test keys.
Do not import these accounts into a real wallet, fund them, or use them for
real posts. The static build excludes tests and tooling. Branch-root Pages
publishing exposes repository files, including public test fixtures; it never
includes a real user key supplied by this project.

## Untrusted content

Event content, names, descriptions, relay strings and NIP-05 errors are built
as DOM text. No untrusted `innerHTML`, `eval`, embedded script, URL-based code
loading or external JavaScript CDN is used. Remote images are HTTPS-only;
links use allowed protocols and `noopener` / `noreferrer`. NIP-05 fetches
omit credentials and referrers and reject redirects.

CSP denies inline application scripts, inline styles, object embeds and base
URL overrides. HTTPS and WSS connections are allowed for user-selected relays
and identity domains; localhost WebSockets are permitted for local testing.
These rules are browser defense-in-depth, not a substitute for trusted hosting.

Incoming structure, byte sizes, tag counts, future timestamps, event IDs,
signatures and query filters are checked. Signature work and received event
counts are bounded per request. Custom local regular expressions can still
be expensive; use simple patterns. Refusing excessive/invalid relay data may
omit events rather than freeze the UI indefinitely.

## Privacy and retained state

Profile images and NIP-05 requests reveal your IP and requested identity to their hosts; both can be disabled. Relays see queries and writes. Manual NIP-42 authentication discloses the signing public key to that relay. There is no telemetry.

Fetched posts, lists, pages, relays and reactions are not persisted. Only public
kind-0 profiles and dated NIP-05 verification are persisted in a dedicated store.
There is no TTL or background refresh; stale data can remain until an explicit
profile refresh. The badge identifies the result as checked at the saved date,
not a guarantee of current identity ownership. Disk reads reverify the metadata
signature, and verification is bound to event ID, pubkey and NIP-05 identifier.

IndexedDB is preferred, with a profile-only localStorage fallback. A blocked or
full storage facility causes a visible warning; the current UI continues without
claiming persistence. Public metadata remains on logout. Browser site-data removal
also deletes this cache, account settings and drafts. Private/incognito browsing
and browser eviction can prevent long-term persistence. Paths partition names,
not security boundaries.

Login keys, settings, drafts, authored pending/partial writes and relay cooldowns
remain in localStorage. Pending writes expire after seven days. A signed relay-list
write in the outbox is not a fetched relay-list cache. Public relay editing reads
latest lists before applying a delta and never changes the app's connection settings.

Older 1.0.x generic IndexedDB stores are not imported or automatically removed.
Complete old pending sends before upgrading. There is no service worker.
Static-asset and image HTTP caching is browser-managed and separate.

GitHub Pages projects under the same owner may share an origin. A path prefix prevents accidental collisions, not access by malicious same-origin code. Use trusted deployments and separate origins when required.

## Availability and known limits

There is no guarantee of relay acceptance, global follower counts, retrieval
of all history, or zero missing messages at pathological timestamp/relay
limits. A confirmed OK means that relay accepted the event, not perpetual
retention or universal propagation. Paid/authenticated relays and other
restrictions may require user action. No restriction-evasion mechanism exists.

The current execution environment blocks browser URL navigation. Unit tests
and native-module/offline-adapted DOM tests ran; real browser SharedWorker,
extension interoperability, GitHub deployment and public-relay acceptance
remain integration checks for a normal browser environment.
