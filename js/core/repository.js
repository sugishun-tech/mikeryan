import { Emitter, chunks, compareEvents, isHex, latest, parseJSON, sortEvents, stableJSON, unique } from './utils.js?v=1.1.0';
import { LIMITS } from './config.js?v=1.1.0';
/** Current screen data and in-progress requests. Completed reads are never reused. */
export class Repository extends Emitter {
  constructor(storage, network, settings) {
    super(); this.network = network; this.settings = settings;
    this.events = new Map(); this.replacements = new Map(); this.replaceQueue = new Map(); this.idQueue = new Map();
    this.replaceTimer = null; this.idTimer = null; this.pending = new Map();
  }
  beginView(owner = null) {
    this.events.clear();
    for (const [key, event] of this.replacements) if (event.pubkey !== owner) this.replacements.delete(key);
  }
  readRelays(all = false) { const s = this.settings.value; return all ? s.relays : s.relays.slice(0, s.readRelayCount); }
  async accept(event) {
    if (!event?.id) return;
    this.events.set(event.id, event);
    if (this.events.size > 4000) this.events.delete(this.events.keys().next().value);
    if ([0,3,10000,10002].includes(event.kind)) {
      const key = `${event.kind}:${event.pubkey}`, current = this.replacements.get(key);
      if (!current || compareEvents(event, current) < 0) {
        this.replacements.set(key, event); this.emit('replace', {key, event});
      }
    }
  }
  async query(filters, {all = false, retain = true} = {}) {
    const result = await this.network.query({relays: this.readRelays(all), filters, gap: this.settings.value.requestGapMs});
    if (retain) await Promise.all(result.events.map(e => this.accept(e)));
    if (result.errors?.length) this.emit('warning', result.errors.map(e => `${e.relay}: ${e.reason}`).join('\n'));
    return result;
  }
  peekProfile(pubkey) {
    const p = parseJSON(this.replacements.get(`0:${pubkey}`)?.content, {});
    return p && !Array.isArray(p) && typeof p === 'object' ? p : {};
  }
  async profile(pubkey) { await this.replacement(0, pubkey); return this.peekProfile(pubkey); }
  async profiles(pubkeys) { await Promise.all(unique(pubkeys).filter(isHex).map(p => this.replacement(0, p))); }
  async replacement(kind, pubkey, {all = false, required = false} = {}) {
    if (!isHex(pubkey)) throw new Error('公開鍵が不正です');
    const key = `${kind}:${pubkey}`, scope = stableJSON(this.readRelays(all));
    const pendingKey = `${scope}:${key}:${required}`;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const promise = new Promise((resolve, reject) => {
      this.replaceQueue.set(pendingKey, {kind, pubkey, key, all, required, resolve, reject});
      if (!this.replaceTimer) this.replaceTimer = setTimeout(() => void this.flushReplacements(), 60);
    }).finally(() => this.pending.delete(pendingKey));
    this.pending.set(pendingKey, promise); return promise;
  }
  async flushReplacements() {
    const queue = [...this.replaceQueue.values()]; this.replaceQueue.clear(); this.replaceTimer = null;
    for (const all of [false, true]) for (const group of chunks(queue.filter(i => i.all === all), LIMITS.filters)) {
      try {
        const result = await this.query(group.map(i => ({kinds: [i.kind], authors: [i.pubkey], limit: 1})), {all});
        for (const item of group) {
          if (item.required && !result.complete) { item.reject(new Error('最新のデータを全リレーで確認できませんでした。既存の設定を消さないため変更を中止しました')); continue; }
          const received = latest(result.events.filter(e => e.kind === item.kind && e.pubkey === item.pubkey));
          // Do not turn a failed/absent read into a successful old response.
          item.resolve(received);
        }
      } catch (error) { for (const item of group) item.required ? item.reject(error) : item.resolve(null); }
    }
  }
  /** Names and own reactions for this batch share a bounded REQ, not one REQ per post. */
  async decorate(events, pubkey) {
    const authors = unique(events.map(e => e.pubkey)).filter(isHex);
    const ids = unique(events.filter(e => e.kind === 1).map(e => e.id));
    const filters = authors.map(author => ({kinds:[0], authors:[author], limit:1}));
    if (pubkey && ids.length) filters.push({kinds:[7], authors:[pubkey], '#e':ids, limit:Math.min(60, ids.length * 2)});
    if (!filters.length) return {events:[], complete:true, errors:[]};
    return this.query(filters);
  }
  async event(id) {
    if (!isHex(id)) return null;
    if (this.pending.has(`id:${id}`)) return this.pending.get(`id:${id}`);
    const promise = new Promise(resolve => {
      this.idQueue.set(id, resolve);
      if (!this.idTimer) this.idTimer = setTimeout(() => void this.flushIds(), 60);
    }).finally(() => this.pending.delete(`id:${id}`));
    this.pending.set(`id:${id}`, promise); return promise;
  }
  async flushIds() {
    const entries = [...this.idQueue.entries()]; this.idQueue.clear(); this.idTimer = null;
    for (const group of chunks(entries, 100)) {
      let result;
      try { result = await this.query([{ids: group.map(([id]) => id), limit: group.length}]); }
      catch { result = {events:[]}; }
      for (const [id, resolve] of group) resolve(result.events.find(e => e.id === id) ?? null);
    }
  }
  async published(event) { await this.accept(event); this.emit('published', event); }
}
