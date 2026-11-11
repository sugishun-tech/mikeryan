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
as DOM text. No untrusted `innerHTML`, `eval`, or arbitrary URL-based code
loading is used. No provider script executes in the account document. X/Twitter posts use a cross-origin sandbox frame hosted by X. Remote images are HTTPS-only;
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

Fetched posts, lists, pages, relays and reactions are not retained as a general
read cache. Public kind-0 profiles and dated NIP-05 verification are persisted in
a dedicated store; the reaction-reply evidence exception is described below.
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
remain in localStorage. Ordinary pending writes expire after seven days. A signed relay-list
write in the outbox is not a fetched relay-list cache. Public relay editing reads
latest lists before applying a delta and never changes the app's connection settings.

Notification reaction replies have a separate `reaction-replies:<pubkey>` ledger
containing locally authored signed events, the signed received reactions they
target, and delivery results. A received reaction is retained only as evidence
needed to validate that reply and its retries, not as a general retrieval cache.
This ledger has no expiration, so accepted and uncertain sends remain distinguishable
after reload. Fetched likes used for reconciliation remain in memory only. Browser
site-data removal or eviction also removes this duplicate-prevention history.

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

See `TEST_RESULTS.md` for the tests actually executed for this version and their
limits. Narrow DOM/event fixtures do not establish browser layout, live HTTP CSP,
browser SharedWorker, extension interoperability, deployment or public-relay
acceptance. Tests use public fixtures, not real accounts or public-relay writes.

## Large public lists

Public list kinds 3, 10000 and 10002 are bounded at 4 MiB of serialized UTF-8 and 50,000 tags. Other events retain the 256 KiB / 10,000-tag limits. Incoming frames are bounded at 8 MiB before parsing. Oversize public lists and frames fail the read instead of being treated as a successful empty list. Signatures and event IDs are still verified; these larger limits do not permit unsigned or malformed data. A verification-provider exception settles the request as incomplete instead of leaving the queue pending. No missing-row fix disables mute or display filters.


## Rich embeds (1.3.4)

The main page retains script-src self. frame-src permits the existing YouTube
origin and platform.twitter.com. X/Twitter posts use the provider's display frame
directly, without running widgets.js in the account document. The cross-origin
frame permits scripts, its own origin and user-opened popups. The parent validates
message source, exact origin, RPC envelope and positive finite height. It waits
for rendering and size notifications, and falls back to a link on no results or
timeout. This is a compatibility wire adapter, not a published JavaScript API.
Visibility loading and cleanup apply independently to every post. Matching media
URLs in different posts are displayed in each post. Direct media URLs continue
to follow the ordinary image-loading rules.

YouTube uses a direct cross-origin privacy-enhanced iframe. The sandbox permits
its own origin, scripts and presentation; this is NOT a same-origin local script
frame. Its notification adapter requires exact source and origin, a finite
handshake and a timeout. This is a compatibility wire adapter, not the published
IFrame JavaScript API. Failure to obtain readiness downgrades to a link.

Embedding contacts third parties and can disclose IP addresses and browser
information. Privacy-enhanced mode is not anonymous browsing. Browser/proxy
caching is outside the app's promise not to persist fetched posts and media.
Image display limits do not cap the remote resource's byte size.

Repost JSON is verified independently of its wrapper signature. Unverified,
mismatching, cyclic or oversized data is never rendered as an authenticated
original. Referenced events use configured relays only. One direct slot per post, at most two nested levels,
bounded memo and text/link pagination limit automatic expansion. Timers,
listeners and frame jobs are disposed when their owner disappears.

## Notification reaction replies

Only an explicit click on an eligible top-level notification can create a reply
like. The target must be another author's kind:7 event whose last p tag identifies
the current account. Before signing, the author of the event referenced by its
last e tag is checked against that account. This prevents an incidental inherited
p tag from becoming permission to like an unrelated event. Replies, reposts,
ordinary posts and embedded cards do not expose this action.

The outgoing NIP-25 event has kind:7, content `+`, one e tag for the received
reaction itself, one p tag for its author and one k tag with `7`. Original-post
tags are not copied. NIP-07 signing verifies the requested content and current
account. Generic Social.publish, sendSigned and retry still reject kind:7;
notification replies use their dedicated validation and delivery path.

New replies require Web Locks for account-scoped cross-tab exclusion and a
successful persistent ledger write before transport. The client checks the
ledger and queries every configured relay for its own existing reactions to
the single target. Matching results are validated by their last e tag and
content; incomplete reads, errors or a full 100-event result stop a new send.
No background process sends reply likes. Red hearts indicate confirmed likes
and are not toggle controls for creating additional events.

Uncertain and partially accepted sends retain the exact signed event. Settings
offer explicit retry to failed relays only, without a new signature or event ID.
Legacy kind:7 events aimed at ordinary posts remain excluded from resend. The
relay pool's existing throttling and refusal handling apply to this path too.

NIP-25 does not impose one reaction per author/target, and separate devices or
clients can still race. A relay can omit stored events, and unconfigured relays
are not searched. Ledger persistence and reconciliation therefore reduce duplicate
creation within the observed scope; they do not guarantee global exactly-once
delivery or another client's interpretation of a reaction-to-reaction event.
