# Integration and migration map

| Original area | New modules / behavior |
| --- | --- |
| mynostr `auth.js` | `auth/session.js`: public-key restore and NIP-07 queue |
| mynostr `network.js`, profile `nostr.js` | `network/*` + `core/repository.js`: one network service |
| mynostr `feed.js` | `feed/view.js`, `feed/pagination.js`, `feed/moderation.js` |
| mynostr `actions.js` | `social/service.js`: publish, replies, reactions, outbox |
| mynostr `ui_render.js` | `ui/posts.js`, `ui/identity.js`, `ui/dom.js` |
| mynostr `ui_nav.js` | `core/router.js` + `app.js`: hash routes in one site |
| mynostr `profile.js`, mynostr_profile UI | `profiles/view.js`: header, editor and five tabs |
| profile NIP-05 | `profiles/nip05.js`: shared checks on all author names |
| profile follow/unfollow and mutual | `social/service.js` + `ui/identity.js`: in-place updates |
| profile relay dictionary | kind:10002 preferred; kind:3 content fallback |
| mynostr settings | `settings/store.js`, `settings/view.js`: full settings and import/export |
| old client name | New events consistently use `['client','mikeryan']` |
| independent login buttons | One restored account across all views |

## Retained old localStorage keys

The importer reads, without deleting:

```text
nostr_relays
nostr_batch_size
nostr_mute_display_name_patterns
nostr_mute_content_patterns
nostr_muted_pubkeys
nostr_profile_viewer_relays
nostr_profile_viewer_last_login_pubkey
```

The old timeline relay list is newline separated; the profile app's list is
JSON. A migrated relay list is a deduplicated union. Settings are then written
in the new path-scoped namespace. If the old values are absent, `default.json`
is used. Malformed legacy settings fall back to safe defaults rather than
silently treating an invalid regex as a valid filter.

The default old `nostr\:` regex uses JavaScript's non-Unicode `i` semantics,
like the original. In particular the identity escape `\:` would be invalid
with the `u` flag, so the migration does not add that flag.

## URLs

New paths do not require server rewrites:

```text
#/global
#/home
#/notifications
#/settings
#/me
#/profile/<64-character-lowercase-hex>/posts
#/profile/<hex>/following
#/profile/<hex>/followers
#/profile/<hex>/mutes
#/profile/<hex>/relays
#/thread/<event-id>
```

Legacy `?hex=...`, `?npub=...`, `?view=me`, `?me=1`, `?settings=1`,
`?view=home`, `?view=notifications`, and `?view=thread&event=...` are parsed on
the new site when no hash route is present. The thread ID also accepts the
old `id`, `eventId` and `event_id` parameter names. Old URLs on a different,
removed Pages repository still need a redirect hosted there.

## Deliberate behavior changes

No new subscriptions begin merely because another inactive profile tab
exists. Fetching a page does not silently download many extra pages to fill
space after filtering. Infinite follower crawling, background reactions
history retrieval and automatic reconnection are replaced with bounded,
explicit actions. "いいね同期" queries the signed-in user's reactions to the
currently rendered post set, up to 200 IDs, rather than the complete history.

Unverified/mismatched NIP-05 claims never get the verified mark. A network
error is unknown rather than a false accusation. Public-key mutes apply to
notifications; ordinary name/body/profile-completeness filters do not.
Deliberately opened profile posts are shown independently of timeline mutes,
as in the separate original profile app.

Profile/contact-list writes will fail closed if the latest list cannot be
checked on every configured relay. This is preferable to erasing contacts
or unknown metadata due to an unavailable source. The editor preserves
fields it does not understand and the follow writer preserves unrelated tags.
