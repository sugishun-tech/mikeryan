import { RelayConnection } from './relay.js?v=1.1.1';
import { LIMITS } from '../core/config.js?v=1.1.1';
import { canonicalFilters, chunks, normalizeRelay, sortEvents, stableJSON, unique } from '../core/utils.js?v=1.1.1';
import { missingProfileFilters } from './profile-batch.js?v=1.1.1';
import { verifyEvent } from '../core/crypto.js?v=1.1.1';

export class RelayPool {
  constructor(storage, options = {}) { this.storage = storage; this.options = options; this.connections = new Map(); this.inflight = new Map(); this.coalesced = 0; }
  connection(url, gap = 1200) {
    if (!this.connections.has(url)) this.connections.set(url, new RelayConnection(url, this.storage, { ...this.options, gap }));
    const conn = this.connections.get(url); conn.gap = Math.max(gap, this.options.gap ?? 0); return conn;
  }
  urls(relays) { const urls = unique(relays.map(normalizeRelay).filter(Boolean)); if (!urls.length || urls.length > LIMITS.relays) throw new Error('リレー設定が不正です'); return urls; }
  async query({ relays, filters, gap = 1200, profileBatch = false }) {
    const urls = this.urls(relays), normalized = canonicalFilters(filters);
    if (!normalized.length) return { events: [], complete: true, errors: [] };
    if (normalized.length > 400) throw new Error('一度の問い合わせが大きすぎます。フォロー数を減らすか、個別のプロフィールを開いてください');
    for (const f of normalized) {
      if (!Number.isInteger(f.limit) || f.limit < 1 || f.limit > LIMITS.maxPageLimit) throw new Error('取得上限が不正です');
      if (Object.values(f).some(v => Array.isArray(v) && !v.length)) throw new Error('空の検索条件は利用できません');
    }
    const key = `query:${stableJSON([urls, normalized, profileBatch])}`;
    if (this.inflight.has(key)) { this.coalesced++; return this.inflight.get(key); }
    const task = (async () => {
      const events = [], errors = [];
      // Every relay finishes independently. The fastest relay cannot truncate the others.
      await Promise.all(urls.map(async url => {
        for (const group of chunks(normalized, LIMITS.filters)) {
          try {
            const received = await this.connection(url, gap).query(group);
            events.push(...received);
            if (profileBatch) {
              // One repair pass, per relay; a result from another relay cannot
              // hide this relay's missing/newer profile. Rate limiting stops here.
              for (const repair of chunks(missingProfileFilters(group, received), LIMITS.filters)) {
                events.push(...await this.connection(url, gap).query(repair));
              }
            }
          }
          catch (e) { events.push(...(e.partial ?? [])); errors.push({ relay: url, reason: e.message }); break; }
        }
      }));
      const result = { events: sortEvents(events), complete: errors.length === 0, errors };
      return result;
    })();
    this.inflight.set(key, task);
    try { return await task; } finally { this.inflight.delete(key); }
  }
  async publish({ relays, event, gap = 1200 }) {
    if (!(await verifyEvent(event))) throw new Error('署名またはイベントIDが不正です');
    const urls = this.urls(relays), key = `publish:${event.id}:${stableJSON(urls)}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = (async () => {
      const results = await Promise.all(urls.map(async relay => {
        try { await this.connection(relay, gap).publish(event); return { relay, accepted: true }; }
        catch (e) { return { relay, accepted: false, reason: e.message }; }
      }));
      return { results, accepted: results.filter(r => r.accepted).length, total: results.length };
    })();
    this.inflight.set(key, task);
    try { return await task; } finally { this.inflight.delete(key); }
  }
  async authInfo({ relay }) {
    relay = this.urls([relay])[0]; const c = this.connection(relay);
    await c.connect(); return { relay, challenge: c.challenge };
  }
  async authenticate({ relay, event }) {
    relay = this.urls([relay])[0]; const c = this.connection(relay);
    if (event.kind !== 22242 || !event.tags.some(t => t[0] === 'relay' && t[1] === relay) || !event.tags.some(t => t[0] === 'challenge' && t[1] === c.challenge) || !await verifyEvent(event)) throw new Error('リレー認証イベントが不正です');
    return c.publish(event, true);
  }
  stats() { return { relays: [...this.connections.values()].map(c => c.snapshot()), coalesced: this.coalesced }; }
  close() { for (const c of this.connections.values()) c.close(); }
}
