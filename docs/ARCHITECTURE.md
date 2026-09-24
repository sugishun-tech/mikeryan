# Architecture · 1.1.0

## Read lifecycle

`FeedView` measures actual visible post rectangles below the sticky controls and above the mobile navigation. It passes the lower visible post for older reads or the upper visible post for newer reads to `EventPager`. The latest operation uses current epoch seconds, not the old loaded window. All entry points fix the displayed batch limit at 30.

`EventPager` owns only the currently mounted timeline and scalar continuation cursors. It never serializes a page or consults an old read response. `Repository.query()` always calls the transport. Searches use `retain:false` so discarded search results do not populate the current-screen repository. Only the chosen page is accepted for rendering; identity/reaction queries then decorate that page. Existing DOM nodes remain mounted on directional additions. A visible post's screen coordinate is restored after insertion, using actual layout heights rather than content-visibility placeholders.

Old and new pages may overlap when the user is midway through the already displayed timeline. A new relay query is still sent. Duplicate event IDs are not rendered twice. Latest replaces the list after a successful response; a failed empty response does not clear the existing screen.

## NIP-01 constraints

`since` and `until` are inclusive; a request has no exclusive event-ID cursor and no ascending-order flag. Relays return the newest matches first. Merely using `since: anchor` with `limit:30` would jump to the newest posts, not the nearest newer posts.

Older reads include the anchor second, request space for its known same-second prefix, then select at most 30 strictly older items under `(created_at DESC, id ASC)` ordering. A saturated boundary is expanded only up to a fixed limit; the timestamp is not blindly decremented and unreturned same-second events are not silently skipped.

Newer reads initially cover ten minutes from the anchor and narrow saturated intervals. Completed empty intervals can be advanced and widened. At most six range queries are attempted per click. A continuation stores only anchor/range/limit numbers, not response data. A failed relay prevents declaring a range exhausted. Up to 1600 events per filter may be requested for a heavily saturated same-second boundary. Combined responses are deduplicated; at most 30 posts are reflected in the timeline per operation. A relay can impose smaller internal limits or omit events: exhaustive recovery is not guaranteed.

## Reducing communication without caches

Each relay has one connection per transport pool. SharedWorker-capable browsers share the pool across tabs for this application version; fallback is one pool per tab. The worker holds connection/queue state, not a response cache. Identical concurrent requests coalesce only while their Promise is unresolved. A later identical query is sent again.

Profiles use one kind-0 filter per author with limit 1; filters are grouped, at most 20 per REQ. The signed-in user's kind-7 reactions are constrained to the selected page IDs and are included with those filters. Authors are not fetched once per post. Large following lists are split into bounded author filters. No complete reactions history or unopened profile list is downloaded.

Each selected relay is awaited independently. A fast relay's EOSE cannot truncate a slower relay. EOSE finishes that finite query and sends CLOSE; timeout and cancellation paths also close subscriptions. No polling or scrolling-triggered post REQ is used. Queue gaps, bounded timeouts, idle close, and rate-limit cooldowns remain. No proxy rotation or restriction evasion is implemented.

NIP-05 is a separate HTTPS request. Only unresolved identical checks coalesce. Completed verification results are not stored or reused. Fetch uses no-store, no credentials/referrer, rejects redirects, and has time/size/concurrency limits. Existing cards retain their displayed verification state until remounted or rechecked.

## Persisted state, not fetched data

localStorage retains the public key, settings, drafts, authored failed/partial sends, and relay cooldowns. `Storage` accepts only `outbox:` and `health:` operational keys; other keys are rejected. Outbox retry carries forward prior relay acceptance and contacts only undelivered relays. There is no IndexedDB access, Service Worker, persisted read response, saved timeline, or negative profile cache.

Current-screen maps are discarded on navigation (except the active account's UI/list state). Reads do not return those maps instead of making a request. A reply preview can display another post already on the screen; otherwise it fetches the named event only on a user click. Protocol synchronization that relies on a local archive, such as set reconciliation, is not enabled.

## Protocol references

- NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
- NIP-05: https://github.com/nostr-protocol/nips/blob/master/05.md
- NIP-07: https://github.com/nostr-protocol/nips/blob/master/07.md
- NIP-10: https://github.com/nostr-protocol/nips/blob/master/10.md
- NIP-42: https://github.com/nostr-protocol/nips/blob/master/42.md
- NIP-65: https://github.com/nostr-protocol/nips/blob/master/65.md

The statements above describe the implementation, not guarantees that all relays implement every convention identically.
