# Security and privacy

## Secret keys and permissions

Production application code has no private-key signer, secret import or key
export. NIP-07 performs signing. Only a public key is persisted for restoring
the account UI. This is not a server session or proof that an extension is
currently unlocked. At the first restored write the current extension key is
checked; signed template data and event signatures are checked every time.

The application does not suppress extension approval prompts. Grant signing
permission only to a deployment you trust. Log out and clear browser site
data on shared devices when local drafts or cached account data matter.

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

## Privacy and caches

Profile images and NIP-05 requests reveal your IP and the requested identity
to their hosts. Both can be disabled in settings. Your relays see queries and
writes, and manual NIP-42 AUTH discloses the signing public key to that relay.
The application does not send telemetry or analytics.

Public events, queried public lists and the public key remain in local caches.
Draft text is saved in localStorage; failed or partially delivered signed
public events can remain for seven days. Logout does not delete all these
records. Settings' cache clear removes IndexedDB records and the outbox but
not drafts or settings. Full cleanup is the browser's site-data removal.

GitHub Pages projects under the same owner may share an origin. A path-based
storage prefix prevents accidental key collisions, not malicious scripts
from another project on that origin. Only deploy trusted code on a shared
origin; a separate custom domain provides a separate origin.

## Availability and known limits

There is no guarantee of relay acceptance, global follower counts, retrieval
of all history, or zero missing messages at pathological timestamp/relay
limits. A confirmed OK means that relay accepted the event, not perpetual
retention or universal propagation. Paid/authenticated relays and other
restrictions may require user action. No restriction-evasion mechanism exists.

The current execution environment blocks browser URL navigation. Unit tests
and offline-adapted DOM tests ran; real browser SharedWorker, IndexedDB,
extension interoperability, GitHub deployment and public-relay acceptance
remain integration checks for a normal browser environment.
