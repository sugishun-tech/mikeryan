# Architecture

## Boundaries

`app.js` owns only composition, route transitions, account-dependent UI and
service references. Domain behavior belongs to feature directories. `ui/`
creates DOM nodes, never trusts profile or event content as markup.

```text
Feature view → Repository → NetworkClient → SharedWorker → RelayPool
                          ↘ fallback RelayPool (per tab)
RelayPool → one queued RelayConnection per configured relay → WebSocket
Repository / RelayPool → IndexedDB (memory fallback)
Social → Session → window.nostr (NIP-07) → verified signed event → RelayPool
Identity → Nip05 → HTTPS fetch (visible identities only)
```

Everything is static. The worker is a browser SharedWorker, not a server and
not a ServiceWorker. The worker URL is resolved relative to the module and
therefore to the deployed project subpath. Same-URL tabs use a named worker.
The fallback does not claim cross-tab connection sharing.

## Query lifecycle

1. Normalize relay URLs and filter order; combine identical in-flight queries.
2. Reuse a successful short-lived result unless the caller explicitly asks for
   fresh data. Failed/partial reads never become authoritative empty caches.
3. Each relay runs its own queue, with a minimum interval and at most one
   active finite task. Requests split at 20 filters. Read fan-out is configurable.
4. Inspect event structure, response budget, requested filter match and time.
   Hash and Schnorr verification precede acceptance. Known IDs return the
   previously verified object, never an unverified replacement with the same ID.
5. Each relay's EOSE closes only its subscription. Wait for that relay's queued
   signature work before returning. A fast relay cannot end another relay.
6. Merge verified IDs. A partial error carries any already verified results,
   sets `complete: false`, and establishes a relay-specific cooldown.
7. Idle sockets close after two minutes; no timer starts another REQ. No
   background polling, application ping, relay-discovery crawl or automatic retry.

The communication counters count JSON message payloads, not TCP/TLS overhead,
WebSocket framing, HTML/CSS, profile images, or NIP-05 HTTPS traffic. Actual bytes
on the network will differ. This release does not claim a measured percentage
reduction relative to the original apps.

## Metadata and lists

Repository-level 80ms batching groups pending profile and list reads. Each
filter has one author, one kind and `limit: 1`; this is deliberately different
from a single multi-author filter with a shared low limit. The latter can
exclude less-active authors. Batches contain at most 20 such filters.

Latest replaceable events are selected by newest timestamp, then lowest
lexical event ID. A stale outbox retry cannot overwrite a newer local profile.
Fresh writes query all configured relays, including write-only-in-practice
ones. If a relay is unavailable, the edit is refused rather than replacing an
unknown contact list or profile with incomplete data. Remove an unreachable
relay from settings only after deciding that its extra data is not needed.

The follower discovery filter is `kind:3 + #p:owner`. Each candidate's latest,
unfiltered kind:3 is then checked. Finding an old `#p` mention alone is not
proof of a current follow. This adds a bounded lookup to avoid incorrect
followers; cached latest lists are reused. No claim of global completeness is
possible when only selected relays are queried.

## Pagination

Older pages use inclusive `until` plus an ID set. When a boundary second is
full, the next user click expands the limit, up to 1,600. There is at most one
page query per click; there is no invisible loop to fill a filtered page.
Partial relay failures do not advance the historical cursor or mark the feed
exhausted. A full new-message delta restarts a descending cursor to allow a
subsequent older-page operation to bridge a potentially missing interval.

NIP-01 has no stable offset cursor inside one timestamp. A relay may also cap
results below a requested limit. At extreme same-second saturation the UI
warns that some events may remain unavailable and advances past that second.
This is not a guarantee of complete archive enumeration. Query visibility,
relay retention and eventual propagation also limit completeness.

## NIP-05

One identity component is used throughout the app. An IntersectionObserver
starts verification only for nearby rendered names. Metadata can be fetched
in batches for the loaded page, but HTTPS identity checks are viewport-driven.

The cache stores `identifier → returned public key`, and the final badge
compares that key with EACH displayed author's key. A valid lookup for Alice
cannot validate Bob merely because Bob claims Alice's identifier. Explicit
extra names returned by the same domain document are cached too. Unknown
names are not inferred absent from a partial multi-name response.

Requests use HTTPS, no credentials, no referrer, a six-second timeout, a
256KiB response limit and `redirect: error`. At most two run concurrently.
Transport/CORS failure is unknown, not proof of impersonation. A badge is a
DNS-based identifier match, not a real-world identity or content endorsement.

## Account, updates and publication

Only a public key is restored on startup. No extension call is needed for
restored read-only UI. At the first write, the extension's public key must
match. Every returned signed event is checked against the requested body,
tags, kind, timestamp and account and then cryptographically verified.
Queued signing refuses an account change while waiting.

Contact/profile writes serialize within a tab and use the Web Locks API when
available for cross-tab read-modify-write serialization. Unsupported browsers
still have the per-tab queue; concurrent external clients can always race.
The app preserves unknown profile fields, non-p contact tags and contact-list
content. Timestamps advance monotonically for these replaceable writes.

Publishing uses OK acknowledgements, not merely `WebSocket.send()`. Partial
or failed sends store the already-signed public event. Manual retries keep its
ID and signature and skip acknowledged relays. Retention is seven days, with
a cap of 30 outbox events per account. There is no autonomous publishing.

## Storage and UI lifetime

localStorage: path-namespaced settings, public key, logout marker and drafts.
IndexedDB: public events, replaceables, query results, page snapshots, NIP-05,
relay health, ACKs, local liked IDs and signed outbox records. Memory fallback
allows reading when IndexedDB is unavailable; its cache is not durable.

Storage pruning runs on worker startup and every 500 writes. It removes
expired records and retains about 6,000 recent records. Individual page
snapshots can contain multiple loaded pages; the app is not an archive tool.
Path namespacing avoids collisions, not same-origin access by other scripts.

Route generations and connected-node checks prevent a late view result from
replacing the current screen. A started finite request is allowed to finish
and populate shared caches; route changes do not cancel other consumers'
shared work. Subsequent hidden-tab requests are not started. Profile posts
can be deliberately viewed without timeline mute filters; globally filtered
feeds and direct-reply filtering keep their own policies.
