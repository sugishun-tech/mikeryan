import { RelayConnection } from './relay.js';
import { LIMITS, TTL } from '../core/config.js';
import { canonicalFilters, chunks, normalizeRelay, sortEvents, stableJSON, unique } from '../core/utils.js';
import { verifyEvent } from '../core/crypto.js';

export class RelayPool {
  constructor(storage, options = {}) { this.storage = storage; this.options = options; this.connections = new Map(); this.inflight = new Map(); this.queryHits = 0; this.coalesced = 0; this.epoch = 0; }
  connection(url, gap = 1200) {
    if (!this.connections.has(url)) this.connections.set(url, new RelayConnection(url, this.storage, { ...this.options, gap }));
    const conn = this.connections.get(url); conn.gap = Math.max(gap, this.options.gap ?? 0); return conn;
  }
  urls(relays) { const urls = unique(relays.map(normalizeRelay).filter(Boolean)); if (!urls.length || urls.length > LIMITS.relays) throw new Error('リレー設定が不正です'); return urls; }
  async query({ relays, filters, gap = 1200, ttl = TTL.query, fresh = false }) {
    const urls = this.urls(relays), normalized = canonicalFilters(filters);
    if (!normalized.length) return { events: [], complete: true, errors: [], cached: false };
    if (normalized.length > 400) throw new Error('一度の問い合わせが大きすぎます。フォロー数を減らすか、個別のプロフィールを開いてください');
    for (const f of normalized) {
      if (!Number.isInteger(f.limit) || f.limit < 1 || f.limit > LIMITS.maxPageLimit) throw new Error('取得上限が不正です');
      if (Object.values(f).some(v => Array.isArray(v) && !v.length)) throw new Error('空の検索条件は利用できません');
    }
    const key = `query:${this.epoch}:${stableJSON([urls, normalized])}`;
    // A required fresh read must never join a cached read already in flight.
    const flightKey = `${key}:${fresh ? 'fresh' : 'cached'}`;
    if (this.inflight.has(flightKey)) { this.coalesced++; return this.inflight.get(flightKey); }
    const task = (async () => {
      const cached = await this.storage.get(key);
      if (!fresh && cached !== undefined) { this.queryHits++; return { ...cached, cached: true }; }
      const events = [], errors = [];
      // Every relay finishes independently. The fastest relay cannot truncate the others.
      await Promise.all(urls.map(async url => {
        for (const group of chunks(normalized, LIMITS.filters)) {
          try { events.push(...await this.connection(url, gap).query(group)); }
          catch (e) { events.push(...(e.partial ?? [])); errors.push({ relay: url, reason: e.message }); break; }
        }
      }));
      const result = { events: sortEvents(events), complete: errors.length === 0, errors, cached: false };
      // Never cache a network failure as an authoritative empty result.
      if (result.complete) await this.storage.set(key, result, Math.max(0, Math.min(ttl, 300000)));
      return result;
    })();
    this.inflight.set(flightKey, task);
    try { return await task; } finally { this.inflight.delete(flightKey); }
  }
  async publish({ relays, event, gap = 1200 }) {
    if (!(await verifyEvent(event))) throw new Error('署名またはイベントIDが不正です');
    const urls = this.urls(relays), key = `publish:${event.id}:${stableJSON(urls)}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = (async () => {
      const results = await Promise.all(urls.map(async relay => {
        const ackKey = `ack:${relay}:${event.id}`;
        if (await this.storage.get(ackKey)) return { relay, accepted: true, cached: true };
        try { await this.connection(relay, gap).publish(event); await this.storage.set(ackKey, true, TTL.event); return { relay, accepted: true }; }
        catch (e) { return { relay, accepted: false, reason: e.message }; }
      }));
      if (results.some(r => r.accepted)) this.epoch++;
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
  stats() { return { relays: [...this.connections.values()].map(c => c.snapshot()), queryHits: this.queryHits, coalesced: this.coalesced, persistent: this.storage.persistent }; }
  close() { for (const c of this.connections.values()) c.close(); }
}
