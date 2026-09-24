import { Emitter, chunks, compareEvents, isHex, latest, parseJSON, sortEvents, stableJSON, unique } from './utils.js';
import { TTL, LIMITS } from './config.js';
/** A shared, account-independent cache of verified PUBLIC events. */
export class Repository extends Emitter {
  constructor(storage, network, settings) {
    super(); this.storage = storage; this.network = network; this.settings = settings;
    this.events = new Map(); this.replacements = new Map(); this.replaceQueue = new Map(); this.idQueue = new Map();
    this.replaceTimer = null; this.idTimer = null; this.pending = new Map();
  }
  readRelays(all = false) { const s = this.settings.value; return all ? s.relays : s.relays.slice(0, s.readRelayCount); }
  async accept(event) {
    if (!event?.id) return;
    this.events.set(event.id, event);
    if (this.events.size > 4000) this.events.delete(this.events.keys().next().value);
    const saves = [this.storage.set(`event:${event.id}`, event, TTL.event)];
    if ([0,3,10000,10002].includes(event.kind)) {
      const key = `${event.kind}:${event.pubkey}`;
      const persisted = this.replacements.has(key) ? null : await this.storage.get(`latest:${key}`);
      const current = latest([this.replacements.get(key), persisted].filter(Boolean));
      if (current) this.replacements.set(key, current);
      if (!current || compareEvents(event, current) < 0) {
        this.replacements.set(key, event);
        // Event received incidentally is useful, but does not prove that this is the latest.
        saves.push(this.storage.set(`latest:${key}`, event, TTL.event)); this.emit('replace', { key, event });
      }
    }
    await Promise.all(saves);
  }
  async query(filters, { all = false, fresh = false, ttl = TTL.query } = {}) {
    const result = await this.network.query({ relays: this.readRelays(all), filters, gap: this.settings.value.requestGapMs, fresh, ttl });
    await Promise.all(result.events.map(e => this.accept(e)));
    if (result.errors.length) this.emit('warning', result.errors.map(e => `${e.relay}: ${e.reason}`).join('\n'));
    return result;
  }
  peekProfile(pubkey) {
    const e = this.replacements.get(`0:${pubkey}`);
    const p = parseJSON(e?.content, {});
    return p && !Array.isArray(p) && typeof p === 'object' ? p : {};
  }
  async profile(pubkey) { await this.replacement(0, pubkey); return this.peekProfile(pubkey); }
  async profiles(pubkeys) { await Promise.all(unique(pubkeys).filter(isHex).map(p => this.replacement(0, p))); }
  async replacement(kind, pubkey, { fresh = false, all = false, required = false } = {}) {
    if (!isHex(pubkey)) throw new Error('公開鍵が不正です');
    const key = `${kind}:${pubkey}`, scope = stableJSON(this.readRelays(all)), cacheKey = `checked:${scope}:${key}`;
    if (!fresh) {
      const checked = await this.storage.get(cacheKey);
      if (checked !== undefined) { const selected=latest([checked,this.replacements.get(key)].filter(Boolean)); if(selected)this.replacements.set(key,selected); return selected; }
    }
    const stale = this.replacements.get(key) ?? await this.storage.get(`latest:${key}`, true);
    if (stale) this.replacements.set(key, stale);
    const pendingKey = `${scope}:${key}:${fresh}:${required}`;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const promise = new Promise((resolve, reject) => {
      this.replaceQueue.set(pendingKey, { kind, pubkey, key, cacheKey, all, fresh, required, resolve, reject });
      if (!this.replaceTimer) this.replaceTimer = setTimeout(() => void this.flushReplacements(), 80);
    }).finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, promise); return promise;
  }
  async flushReplacements() {
    const queue = [...this.replaceQueue.values()]; this.replaceQueue.clear(); this.replaceTimer = null;
    const groups = new Map();
    for (const item of queue) { const k = `${item.all}:${item.fresh}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(item); }
    for (const items of groups.values()) {
      // Per-author limit:1 filters prevent a prolific author from consuming everybody's limit.
      for (const group of chunks(items, LIMITS.filters)) {
        try {
          const result = await this.query(group.map(i => ({ kinds: [i.kind], authors: [i.pubkey], limit: 1 })), { all: group[0].all, fresh: group[0].fresh });
          for (const item of group) {
            const e = latest(result.events.filter(e => e.kind === item.kind && e.pubkey === item.pubkey));
            const old = this.replacements.get(item.key);
            const selected = latest([e, old].filter(Boolean));
            if (selected) this.replacements.set(item.key, selected);
            if (item.required && !result.complete) { item.reject(new Error('最新のデータを全リレーで確認できませんでした。既存の設定を消さないため変更を中止しました')); continue; }
            if (result.complete) await this.storage.set(item.cacheKey, selected, selected ? (item.kind === 0 ? TTL.profile : TTL.list) : TTL.absent);
            item.resolve(selected);
          }
        } catch (e) { for (const item of group) item.required ? item.reject(e) : item.resolve(this.replacements.get(item.key) ?? null); }
      }
    }
  }
  async event(id) {
    if (!isHex(id)) return null;
    if (this.events.has(id)) return this.events.get(id);
    const stored = await this.storage.get(`event:${id}`);
    if (stored) { this.events.set(id, stored); return stored; }
    if (await this.storage.get(`missing:${stableJSON(this.readRelays())}:${id}`)) return null;
    if (this.pending.has(`id:${id}`)) return this.pending.get(`id:${id}`);
    const p = new Promise(resolve => {
      this.idQueue.set(id, resolve);
      if (!this.idTimer) this.idTimer = setTimeout(() => void this.flushIds(), 80);
    }).finally(() => this.pending.delete(`id:${id}`));
    this.pending.set(`id:${id}`, p); return p;
  }
  async flushIds() {
    const entries = [...this.idQueue.entries()]; this.idQueue.clear(); this.idTimer = null;
    for (const group of chunks(entries, 100)) {
      let result;
      try { result = await this.query([{ ids: group.map(([id]) => id), limit: group.length }]); }
      catch { result = { events: [], complete: false }; }
      for (const [id, resolve] of group) {
        const event = this.events.get(id) ?? null;
        if (!event && result.complete) await this.storage.set(`missing:${stableJSON(this.readRelays())}:${id}`, true, TTL.absent);
        resolve(event);
      }
    }
  }
  async published(event) {
    await this.accept(event);
    if ([0,3,10000,10002].includes(event.kind)) {
      const key = `${event.kind}:${event.pubkey}`;
      for (const all of [false,true]) await this.storage.delete(`checked:${stableJSON(this.readRelays(all))}:${key}`);
    }
    this.emit('published', event);
  }
}
