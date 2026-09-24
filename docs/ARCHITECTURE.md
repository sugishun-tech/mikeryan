# Architecture · 1.1.1

## Read lifecycle

`FeedView` measures actual visible post rectangles below the sticky controls and above the mobile navigation. It passes the lower visible post for older reads or the upper visible post for newer reads to `EventPager`. The latest operation uses current epoch seconds, not the old loaded window. All entry points fix the displayed batch limit at 30.

`EventPager` owns only the currently mounted timeline and scalar continuation cursors. It never serializes a page or consults an old read response. `Repository.query()` always calls the transport. Searches use `retain:false` so discarded search results do not populate the current-screen repository. Only the chosen page is accepted for rendering; identity/reaction queries then decorate that page. Existing DOM nodes remain mounted on directional additions. A visible post's screen coordinate is restored after insertion, using actual layout heights rather than content-visibility placeholders.

Old and new pages may overlap when the user is midway through the already displayed timeline. A new relay query is still sent. Duplicate event IDs are not rendered twice. Latest replaces the list after a successful response; a failed empty response does not clear the existing screen.

## NIP-01 constraints

`since` and `until` are inclusive; a request has no exclusive event-ID cursor and no ascending-order flag. Relays return the newest matches first. Merely using `since: anchor` with `limit:30` would jump to the newest posts, not the nearest newer posts.

Older reads include the anchor second, request space for its known same-second prefix, then select at most 30 strictly older items under `(created_at DESC, id ASC)` ordering. A saturated boundary is expanded only up to a fixed limit; the timestamp is not blindly decremented and unreturned same-second events are not silently skipped.

Newer reads initially cover ten minutes from the anchor and narrow saturated intervals. Completed empty intervals can be advanced and widened. At most six range queries are attempted per click. A continuation stores only anchor/range/limit numbers, not response data. A failed relay prevents declaring a range exhausted. Up to 1600 events per filter may be requested for a heavily saturated same-second boundary. Combined responses are deduplicated; at most 30 posts are reflected in the timeline per operation. A relay can impose smaller internal limits or omit events: exhaustive recovery is not guaranteed.

## Reducing communication without persistent caches

Each relay has one connection per transport pool. SharedWorker-capable browsers share the pool across tabs for this application version; fallback is one pool per tab. The worker holds connection/queue state, not a response cache. Identical concurrent requests coalesce only while their Promise is unresolved. A later identical query is sent again.

Successful, valid kind-0 metadata is retained in this tab's session. `Repository.profileReads` records the selected relay scope for up to 2000 identities. Scope changes and `fresh`, `all`, or `required` reads bypass reuse. A new tab/reload and logout/account changes discard it. This is explicitly in-memory metadata reuse, not a persisted read-response cache. It can be stale until a manual profile refresh; read-before-write always queries all configured relays.

`Repository.batchQuery()` coalesces metadata/detail reads for 60ms, grouped by a snapshot of relay URLs and session generation. `replacementRead()` shares in-flight identity queries across feed and profile paths. `profile-batch.js` compacts only unfiltered-in-time kind-0 queries whose limit equals the number of authors. It never widens ordinary event, time-constrained or tag-constrained filters. At most 100 authors are put in one filter. The signed-in user's kind-7 reactions are constrained to the selected page IDs and share this REQ. Reactions and post queries are always fresh, even when negative. No unopened list, full reactions history, or unseen author prefetch is introduced.

NIP-01 specifies that replaceable-event reads should return only the latest event for each author/kind. A conforming relay can therefore return 30 profiles for one authors-list filter with limit 30. Relays may clamp the limit or retain/return duplicates. With `profileBatch:true`, `RelayPool` checks missing authors independently on EACH relay after a positive successful response. One repair pass uses single-author limit-1 filters, at most 20 per REQ. It never repeats returned authors or the reaction filter. An entirely empty EOSE has no evidence of truncation and triggers no repair. Failed queries do not trigger repair; failure during repair stops remaining chunks for that relay. This bounded fallback is not a completeness guarantee for arbitrary relays. The fastest relay cannot suppress missing-author checks on another relay.

Malformed, absent and partial/error responses do not become positive reusable metadata. No negative-cache entries are created. An old valid version cannot mark a newer malformed replacement as successful. Logout generations prevent late metadata responses from re-populating a cleared session. Published own metadata updates the in-memory display without a redundant fetch. `fresh:true` returns only the actual newly received event for write preflights, not an old fallback.

Each selected relay is awaited independently. A fast relay's EOSE cannot truncate a slower relay. EOSE finishes that finite query and sends CLOSE; timeout and cancellation paths also close subscriptions. No polling or scrolling-triggered post REQ is used. Queue gaps, bounded timeouts, idle close, and rate-limit cooldowns remain. No proxy rotation or restriction evasion is implemented.

NIP-05 is a separate HTTPS request. Only unresolved identical checks coalesce. Completed verification results are not stored or reused. Fetch uses no-store, no credentials/referrer, rejects redirects, and has time/size/concurrency limits. Existing cards retain their displayed verification state until remounted or rechecked.

## Persisted state, not fetched data

localStorage retains the public key, settings, drafts, authored failed/partial sends, and relay cooldowns. `Storage` accepts only `outbox:` and `health:` operational keys; other keys are rejected. Outbox retry carries forward prior relay acceptance and contacts only undelivered relays. There is no IndexedDB access, Service Worker, persisted read response, saved timeline, or negative profile cache.

Post maps are discarded on navigation. Only positive session profiles and the active account's UI/list state are retained. Post/detail reads never substitute those maps for a request; explicit profile refresh and all read-before-write paths bypass profile reuse. A reply preview can display another post already on the screen; otherwise it fetches the named event only on a user click. Protocol synchronization that relies on a local archive, such as set reconciliation, is not enabled.

## Protocol references

- NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
- NIP-05: https://github.com/nostr-protocol/nips/blob/master/05.md
- NIP-07: https://github.com/nostr-protocol/nips/blob/master/07.md
- NIP-10: https://github.com/nostr-protocol/nips/blob/master/10.md
- NIP-42: https://github.com/nostr-protocol/nips/blob/master/42.md
- NIP-65: https://github.com/nostr-protocol/nips/blob/master/65.md

The statements above describe the implementation, not guarantees that all relays implement every convention identically.

## Measurement

See TRAFFIC.md and traffic-results.json for the actual production-code wire-counter comparison against the uploaded 1.1.0 source. REQ/filter/event/JSON-byte counts are not estimates of relay CPU or I/O. Missing-author repair and upward range probes are excluded from that typical-case benchmark and covered by separate tests.
