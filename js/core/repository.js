import { Emitter, chunks, compareEvents, isHex, latest, matchesFilter, parseJSON, sortEvents, stableJSON, unique } from './utils.js?v=1.1.1';
import { LIMITS } from './config.js?v=1.1.1';
import { compactProfileFilters } from '../network/profile-batch.js?v=1.1.1';

const emptyResult = () => ({events: [], complete: true, errors: []});
const relayScope = relays => stableJSON(unique(relays).sort());

/** Posts are fetched on every manual read. Successfully fetched profiles alone
 * may be reused in this tab's session; no fetched data is written to storage.
 */
export class Repository extends Emitter {
  constructor(storage, network, settings) {
    super(); this.network = network; this.settings = settings;
    this.events = new Map(); this.replacements = new Map(); this.profileReads = new Map();
    this.batchQueue = []; this.batchTimer = null; this.idQueue = new Map(); this.idTimer = null;
    this.pending = new Map(); this.generation = 0; this.owner = null;
  }
  beginView(owner = null) {
    this.owner = owner; this.events.clear();
    // Keep only session profiles and the account's current lists across views.
    for (const [key, event] of this.replacements) {
      if (event.kind !== 0 && event.pubkey !== owner) this.replacements.delete(key);
    }
  }
  resetSession() {
    this.generation++; this.events.clear(); this.replacements.clear(); this.profileReads.clear();
  }
  readRelays(all = false) { const s = this.settings.value; return [...(all ? s.relays : s.relays.slice(0, s.readRelayCount))]; }
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
  async query(filters, {all = false, retain = true, relays = this.readRelays(all), profileBatch = false} = {}) {
    const result = await this.network.query({relays, filters, profileBatch, gap: this.settings.value.requestGapMs});
    if (retain) await Promise.all(result.events.map(e => this.accept(e)));
    if (result.errors?.length) this.emit('warning', result.errors.map(e => `${e.relay}: ${e.reason}`).join('\n'));
    return result;
  }
  peekProfile(pubkey) {
    const p = parseJSON(this.replacements.get(`0:${pubkey}`)?.content, {});
    return p && !Array.isArray(p) && typeof p === 'object' ? p : {};
  }
  knownProfile(pubkey, relays) {
    if (this.profileReads.get(pubkey) !== relayScope(relays)) return null;
    const event = this.replacements.get(`0:${pubkey}`);
    if (!event) return null;
    const profile = parseJSON(event.content);
    if (!profile || Array.isArray(profile) || typeof profile !== 'object') {
      this.profileReads.delete(pubkey); return null;
    }
    // Touch LRU only on actual use, not with a background expiry/refetch timer.
    this.profileReads.delete(pubkey); this.profileReads.set(pubkey, relayScope(relays));
    return event;
  }
  rememberProfiles(events, relays) {
    for (const event of events) {
      if (event.kind !== 0) continue;
      // A valid old version must not turn a malformed newer replacement into
      // a reusable success (the newest event remains the displayed source).
      const current = this.replacements.get(`0:${event.pubkey}`) ?? event;
      const profile = parseJSON(current.content);
      if (!profile || Array.isArray(profile) || typeof profile !== 'object') {
        this.profileReads.delete(event.pubkey); continue;
      }
      this.profileReads.delete(event.pubkey); this.profileReads.set(event.pubkey, relayScope(relays));
    }
    // Bound tab memory; eviction does not fetch anything until the user reads again.
    while (this.profileReads.size > LIMITS.sessionProfiles) {
      const key = [...this.profileReads.keys()].find(key => key !== this.owner);
      this.profileReads.delete(key); this.replacements.delete(`0:${key}`);
    }
  }
  async profile(pubkey, options = {}) { await this.replacement(0, pubkey, options); return this.peekProfile(pubkey); }
  async profiles(pubkeys, options = {}) { await Promise.all(unique(pubkeys).filter(isHex).map(p => this.replacement(0, p, options))); }

  /** The profile path and the feed decoration path share in-progress reads. */
  replacementRead(kind, pubkey, {all = false, fresh = false, required = false} = {}) {
    if (!isHex(pubkey)) return Promise.reject(new Error('公開鍵が不正です'));
    const relays = this.readRelays(all);
    // Writes/all-relay reads must NEVER be satisfied from session metadata.
    const known = kind === 0 && !fresh && !all && !required ? this.knownProfile(pubkey, relays) : null;
    if (known) return Promise.resolve({...emptyResult(), events: [known]});
    const key = `replace:${this.generation}:${relayScope(relays)}:${kind}:${pubkey}:${fresh}:${required}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.batchQuery([{kinds: [kind], authors: [pubkey], limit: 1}], relays)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise); return promise;
  }
  async replacement(kind, pubkey, options = {}) {
    const result = await this.replacementRead(kind, pubkey, options);
    if (options.required && !result.complete) throw new Error('最新のデータを全リレーで確認できませんでした。既存の設定を消さないため変更を中止しました');
    // An absent/failed forced read is not replaced with an old response.
    return latest(result.events.filter(e => e.kind === kind && e.pubkey === pubkey));
  }
  batchQuery(filters, relays = this.readRelays()) {
    if (!filters.length) return Promise.resolve(emptyResult());
    return new Promise(resolve => {
      this.batchQueue.push({filters, relays, generation: this.generation, resolve});
      if (!this.batchTimer) this.batchTimer = setTimeout(() => void this.flushBatch(), 60);
    });
  }
  async flushBatch() {
    const queue = this.batchQueue; this.batchQueue = []; this.batchTimer = null;
    const groups = new Map();
    for (const item of queue) {
      const key = `${item.generation}:${relayScope(item.relays)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    await Promise.all([...groups.values()].map(async group => {
      const {relays, generation} = group[0];
      try {
        const filters = compactProfileFilters(group.flatMap(item => item.filters));
        const result = await this.query(filters, {relays, profileBatch: true, retain: false});
        if (generation === this.generation) {
          await Promise.all(result.events.map(event => this.accept(event)));
          // No negative caching; partial/failing reads remain eligible for retry.
          if (result.complete) this.rememberProfiles(result.events, relays);
        }
        for (const item of group) {
          item.resolve({...result, events: result.events.filter(e => item.filters.some(f => matchesFilter(e, f)))});
        }
      } catch (error) {
        const result = {events: [], complete: false, errors: relays.map(relay => ({relay, reason: error.message}))};
        this.emit('warning', error.message);
        for (const item of group) item.resolve(result);
      }
    }));
  }
  /** Unknown authors + this page's own reactions, normally two filters in one REQ.
   * Completed page/like results are not reused, including negative like results.
   */
  async decorate(events, pubkey) {
    const authors = unique(events.map(e => e.pubkey)).filter(isHex);
    const ids = unique(events.filter(e => e.kind === 1).map(e => e.id)).filter(isHex);
    const reads = authors.map(author => this.replacementRead(0, author));
    if (isHex(pubkey) && ids.length) {
      const filters = chunks(ids, LIMITS.page).map(group => ({
        kinds: [7], authors: [pubkey], '#e': group, limit: Math.min(60, group.length * 2)
      }));
      reads.push(this.batchQuery(filters));
    }
    const results = await Promise.all(reads);
    const errors = [...new Map(results.flatMap(r => r.errors ?? []).map(e => [stableJSON(e), e])).values()];
    return {events: sortEvents(results.flatMap(r => r.events)), complete: results.every(r => r.complete), errors};
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
      catch { result = {events: []}; }
      for (const [id, resolve] of group) resolve(result.events.find(e => e.id === id) ?? null);
    }
  }
  async published(event) {
    await this.accept(event);
    if (event.kind === 0) this.rememberProfiles([event], this.readRelays());
    this.emit('published', event);
  }
}
