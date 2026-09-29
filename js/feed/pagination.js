import { LIMITS } from '../core/config.js?v=1.2.3';
import { compareEvents, matchesFilter, nowSeconds, sortEvents } from '../core/utils.js?v=1.2.3';

/** Manual, viewport-anchored pages. `events` is the current rendered timeline only. */
export class EventPager {
  constructor(query, baseFilters, size = 30) {
    this.query = query; this.baseFilters = baseFilters; this.size = Math.min(30, Math.max(1, size));
    this.events = new Map(); this.busy = null; this.warning = ''; this.complete = true;
    this.exhausted = false; this.search = null; this.downSearch = null;
  }
  load(direction, anchor = null, now = nowSeconds()) {
    if (this.busy) return this.busy;
    if (!['older', 'newer', 'latest'].includes(direction)) return Promise.reject(new Error('読み込み方向が不正です'));
    this.busy = this.perform(direction, anchor, now).finally(() => { this.busy = null; });
    return this.busy;
  }
  older(anchor = null) { return this.load('older', anchor ?? sortEvents([...this.events.values()]).at(-1)); }
  async request(range, limit) {
    const filters = this.baseFilters.map(f => ({...f, ...range, limit}));
    const result = await this.query(filters);
    this.complete = result.complete;
    if (!result.complete) this.warning = '一部のリレーから取得できませんでした。現在位置は進めていません。';
    const events = sortEvents(result.events);
    // The wire path supplies one independent coverage record per relay/filter.
    // A union count cannot establish that every stream reached the same cursor.
    const sources = result.sources ?? filters.map(filter => {
      const matched = events.filter(e => matchesFilter(e, filter));
      return {filter, count: matched.length, oldest: matched.at(-1), exhausted: matched.length < limit};
    });
    return {...result, events, sources};
  }
  safePrefix(result) {
    const boundaries = result.sources.filter(s => !s.exhausted && s.oldest).map(s => s.oldest);
    const floor = sortEvents(boundaries)[0];
    return floor ? result.events.filter(e => compareEvents(e, floor) <= 0) : result.events;
  }
  snapshot() {
    return {events: new Map(this.events), search: this.search && {...this.search},
      downSearch: this.downSearch && {...this.downSearch}, exhausted: this.exhausted};
  }
  restore(state) {
    this.events = new Map(state.events); this.search = state.search;
    this.downSearch = state.downSearch; this.exhausted = state.exhausted;
  }
  async perform(direction, anchor, now) {
    this.warning = ''; let page;
    if (direction === 'latest' || !anchor) {
      const result = await this.request({until: now}, this.size);
      // Even a NONEMPTY partial result can contain holes. Do not turn it into
      // the next cursor, and do not erase the current screen on a failed read.
      if (!result.complete) return [];
      page = this.safePrefix(result).filter(e => e.created_at <= now).slice(0, this.size);
      this.events.clear(); this.search = null; this.downSearch = null;
      this.exhausted = !page.length && result.sources.every(s => s.exhausted);
      if (result.sources.some(s => s.blocked)) this.warning = 'リレーの件数制限で未確認の境界があります。確認できた範囲のみ表示しています。';
    } else if (direction === 'older') page = await this.below(anchor, now);
    else page = await this.above(anchor, now);
    for (const event of page) this.events.set(event.id, event);
    return page;
  }
  async below(anchor, now) {
    this.search = null;
    // NIP-01 has an inclusive timestamp, not an exclusive (timestamp,id) cursor.
    // Request the known same-second prefix too, then add at most 30 new rows.
    const prefix = [...this.events.values()].filter(e => e.created_at === anchor.created_at && e.id <= anchor.id).length;
    let limit = this.downSearch?.anchor === anchor.id ? this.downSearch.limit : Math.min(LIMITS.maxPageLimit, this.size + prefix);
    for (let attempt = 0; attempt < LIMITS.upwardQueries; attempt++) {
      const result = await this.request({until: Math.min(now, anchor.created_at)}, limit);
      const page = this.safePrefix(result).filter(e => compareEvents(e, anchor) > 0).slice(0, this.size);
      if (!result.complete) return []; // Preserve the cursor when a relay is missing.
      if (page.length) { this.exhausted = false; this.downSearch = null; return page; }
      if (result.sources.every(s => s.exhausted)) { this.exhausted = true; this.downSearch = null; return []; }
      if (result.sources.some(s => s.blocked)) break;
      if (limit >= LIMITS.maxPageLimit) break;
      limit = Math.min(LIMITS.maxPageLimit, limit * 2);
    }
    this.downSearch = {anchor: anchor.id, limit};
    this.warning = '同じ秒の投稿集中またはリレーの件数制限で、この位置から先を確認できませんでした。未取得を飛ばさず同じ位置から再試行します。';
    return [];
  }
  async above(anchor, now) {
    if (anchor.created_at > now) return [];
    let {low, high, span, limit} = this.search?.anchor === anchor.id
      ? this.search : {low: anchor.created_at, high: Math.min(now, anchor.created_at + 600), span: 600, limit: this.size};
    high = Math.min(high, now);
    for (let attempt = 0; attempt < LIMITS.upwardQueries && low <= now; attempt++) {
      this.search = {anchor: anchor.id, low, high, span, limit};
      const result = await this.request({since: low, until: high}, limit);
      if (!result.complete) return [];
      const unfinished = result.sources.filter(s => !s.exhausted);
      if (unfinished.length) {
        // Relays return newest-first. A plain since+limit would jump over the
        // nearest posts, so narrow time before accepting an upward page.
        if (high > low) {
          const firstTime = Math.max(...unfinished.map(s => s.oldest?.created_at ?? high));
          high = low + Math.floor(Math.max(0, firstTime - low) / 2);
          limit = this.size;
        } else if (limit < LIMITS.maxPageLimit) limit = Math.min(LIMITS.maxPageLimit, limit * 2);
        else {
          this.warning = '同じ秒に多数の投稿があります。現在位置に近い投稿を確認できないため、位置は進めていません。';
          return [];
        }
        continue;
      }
      const page = result.events.filter(e => compareEvents(e, anchor) < 0).slice(-this.size);
      if (page.length) { this.search = null; return page; }
      if (high >= now) { this.search = null; return []; }
      // Only skip a time interval after every selected relay completed it.
      low = high + 1; span = Math.min(span * 4, 30 * 86400);
      high = Math.min(now, low + span); limit = this.size;
    }
    this.search = {anchor: anchor.id, low, high, span, limit};
    this.warning = '現在位置に近い投稿を探すため、今回の取得を打ち切りました。「上に読み込む」で検索を続けられます。';
    return [];
  }
}
