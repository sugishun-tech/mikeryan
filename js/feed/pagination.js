import { LIMITS } from '../core/config.js?v=1.2.0';
import { compareEvents, nowSeconds, sortEvents } from '../core/utils.js?v=1.2.0';

/** Manual, viewport-anchored pages. `events` is the current rendered timeline only. */
export class EventPager {
  constructor(query, baseFilters, size = 30) {
    this.query = query; this.baseFilters = baseFilters; this.size = Math.min(30, Math.max(1, size));
    this.events = new Map(); this.busy = null; this.warning = ''; this.complete = true;
    this.exhausted = false; this.search = null;
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
    return {...result, events: sortEvents(result.events)};
  }
  async perform(direction, anchor, now) {
    this.warning = ''; let page;
    if (direction === 'latest' || !anchor) {
      const result = await this.request({until: now}, this.size);
      page = result.events.filter(e => e.created_at <= now).slice(0, this.size);
      // A failed empty read must not erase the current screen.
      if (result.complete || page.length) this.events.clear();
      this.search = null; this.exhausted = false;
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
    let limit = Math.min(LIMITS.maxPageLimit, this.size + prefix);
    for (let attempt = 0; attempt < LIMITS.upwardQueries; attempt++) {
      const result = await this.request({until: Math.min(now, anchor.created_at)}, limit);
      const page = result.events.filter(e => compareEvents(e, anchor) > 0).slice(0, this.size);
      if (!result.complete) return []; // Preserve the cursor when a relay is missing.
      if (page.length) { this.exhausted = false; return page; }
      if (result.events.length < limit) { this.exhausted = true; return []; }
      if (limit >= LIMITS.maxPageLimit) break;
      limit = Math.min(LIMITS.maxPageLimit, limit * 2);
    }
    this.warning = '同じ秒の投稿が多く、この位置から先を確認できませんでした。未取得の投稿を飛ばさないため、位置は進めていません。';
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
      if (result.events.length >= limit) {
        // Relays return newest-first. A plain since+limit would jump over the
        // nearest posts, so narrow time before accepting an upward page.
        if (high > low) {
          const firstTime = result.events.at(-1).created_at;
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
