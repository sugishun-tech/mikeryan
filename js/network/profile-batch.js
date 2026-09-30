import { LIMITS } from '../core/config.js?v=1.3.2';
import { canonicalFilters, chunks, isHex, unique } from '../core/utils.js?v=1.3.2';

/** Only unbounded-in-time, one-latest-per-author kind:0 reads may be combined.
 * Never combine ordinary event filters: their limit applies to the whole filter.
 */
export function isProfileBatch(filter) {
  return Object.keys(filter).every(key => ['kinds', 'authors', 'limit'].includes(key)) &&
    filter.kinds?.length === 1 && filter.kinds[0] === 0 &&
    Array.isArray(filter.authors) && filter.authors.length > 0 && filter.authors.every(isHex) &&
    filter.limit === unique(filter.authors).length;
}

export function compactProfileFilters(filters) {
  const authors = [], other = [];
  for (const filter of filters) {
    if (isProfileBatch(filter)) authors.push(...filter.authors);
    else other.push(filter);
  }
  // NIP-01: a conforming relay returns only the latest replaceable event per author.
  const combined = chunks(unique(authors).sort(), LIMITS.authors).map(group => ({
    kinds: [0], authors: group, limit: group.length
  }));
  return canonicalFilters([...other, ...combined]);
}

/** A relay may silently clamp a broad filter or return historical duplicates.
 * Check missing authors ON THAT RELAY, once, with limit:1 per author. Do not
 * re-fetch already returned authors, repeat reactions, or retry failed relays.
 * An entirely empty EOSE has no evidence of truncation and needs no repair.
 */
export function missingProfileFilters(filters, events) {
  const repairs = [];
  for (const filter of filters) {
    if (!isProfileBatch(filter) || filter.authors.length < 2) continue;
    const found = new Set(events.filter(e => e.kind === 0 && filter.authors.includes(e.pubkey)).map(e => e.pubkey));
    if (!found.size && !events.length) continue;
    for (const author of filter.authors) {
      if (!found.has(author)) repairs.push({kinds: [0], authors: [author], limit: 1});
    }
  }
  return canonicalFilters(repairs);
}

/** Missing exact latest-state filters cannot be treated as empty lists when
 * other filters in the same REQ did return data. Repair ON THAT relay, using
 * one filter per REQ. Empty isolated EOSE remains a legitimate absent event.
 */
export function missingReplacementFilters(filters, events, {excludeProfiles = false} = {}) {
  const repairs = [];
  for (const f of filters) {
    const kind = f.kinds?.[0];
    if (!Object.keys(f).every(key => ['kinds', 'authors', 'limit'].includes(key)) ||
        f.kinds?.length !== 1 || ![0, 3, 10000, 10002].includes(kind) ||
        (excludeProfiles && kind === 0) || !f.authors?.length ||
        f.limit !== unique(f.authors).length) continue;
    if (filters.length === 1 && f.authors.length === 1) continue;
    // Even a sole broad contact filter can be silently restricted to its
    // first author. An empty response must not mark every other user absent.
    // Profiles keep their lower-traffic policy; public lists need exact checks.
    if (!events.length && kind === 0) continue;
    for (const author of f.authors) if (!events.some(e => e.kind === kind && e.pubkey === author)) {
      repairs.push({kinds:[kind],authors:[author],limit:1});
    }
  }
  return canonicalFilters(repairs);
}

/** Kind 3/10000/10002 also have one latest event per author. Keep kinds
 * separate and never compact bounded/history filters or ordinary notes. */
export function compactLatestFilters(filters) {
  const other = [], kinds = new Map();
  for (const f of filters) {
    const kind = f.kinds?.[0];
    if (Object.keys(f).every(k => ['kinds', 'authors', 'limit'].includes(k)) &&
        f.kinds?.length === 1 && [3, 10000, 10002].includes(kind) &&
        f.authors?.length && f.authors.every(isHex) && f.limit === unique(f.authors).length) {
      if (!kinds.has(kind)) kinds.set(kind, []);
      kinds.get(kind).push(...f.authors);
    } else other.push(f);
  }
  for (const [kind, keys] of kinds) for (const authors of chunks(unique(keys).sort(), LIMITS.authors)) {
    other.push({kinds:[kind],authors,limit:authors.length});
  }
  return compactProfileFilters(other);
}
