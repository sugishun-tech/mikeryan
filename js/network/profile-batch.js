import { LIMITS } from '../core/config.js?v=1.2.0';
import { canonicalFilters, chunks, isHex, unique } from '../core/utils.js?v=1.2.0';

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
    if (!found.size) continue;
    for (const author of filter.authors) {
      if (!found.has(author)) repairs.push({kinds: [0], authors: [author], limit: 1});
    }
  }
  return canonicalFilters(repairs);
}
