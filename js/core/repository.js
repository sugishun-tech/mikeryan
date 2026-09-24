import { Emitter, chunks, compareEvents, isHex, latest, matchesFilter, parseJSON, sortEvents, stableJSON, unique } from './utils.js?v=1.2.0';
import { LIMITS } from './config.js?v=1.2.0';
import { ProfileCache, validProfile } from '../profiles/cache.js?v=1.2.0';
import { compactProfileFilters } from '../network/profile-batch.js?v=1.2.0';

const emptyResult = () => ({events: [], complete: true, errors: []});
const relayScope = relays => stableJSON(unique(relays).sort());

/** Only kind:0 is persistent. Posts and lists belong to the current view. */
export class Repository extends Emitter {
  constructor(storage, network, settings, {profileCache, verifier} = {}) {
    super(); this.network = network; this.settings = settings;
    this.events = new Map(); this.replacements = new Map(); this.profileReads = new Map();
    this.batchQueue = []; this.batchTimer = null; this.idQueue = new Map(); this.idTimer = null;
    this.pending = new Map(); this.generation = 0; this.owner = null;
    this.profileCache = profileCache ?? new ProfileCache({onError:error=>this.emit('storageWarning',error.message)});
    this.verifier = verifier; this.profileRecords = new Map(); this.profileLoads = new Map();
  }
  beginView(owner = null) {
    this.generation++; this.owner = owner; this.events.clear();
    // Lists must not survive navigation, even the current account's lists.
    for (const [key, event] of this.replacements) if (event.kind !== 0) this.replacements.delete(key);
  }
  resetSession() {
    this.generation++; this.events.clear();
    for (const [key,event] of this.replacements) if (event.kind !== 0) this.replacements.delete(key);
    // Public profile data is deliberately shared across login/logout and reloads.
  }
  async cachedProfiles(pubkeys) {
    await Promise.all(unique(pubkeys).filter(isHex).map(async key => {
      if (this.profileRecords.has(key)) return;
      if (!this.profileLoads.has(key)) {
        const load = this.profileCache.get(key).then(record => { if (record && !this.profileRecords.has(key)) this.installProfile(record); })
          .finally(()=>this.profileLoads.delete(key));
        this.profileLoads.set(key,load);
      }
      await this.profileLoads.get(key);
    }));
  }
  installProfile(record) {
    const event=record.event;
    this.profileRecords.delete(event.pubkey); this.profileRecords.set(event.pubkey,record);
    this.profileReads.set(event.pubkey,true); this.replacements.set(`0:${event.pubkey}`,event);
    while (this.profileRecords.size > LIMITS.sessionProfiles) {
      const key=[...this.profileRecords.keys()].find(key=>key!==this.owner);
      this.profileRecords.delete(key); this.profileReads.delete(key); this.replacements.delete(`0:${key}`);
    }
    this.emit('replace',{key:`0:${event.pubkey}`,event});
  }
  verification(pubkey) { return this.profileRecords.get(pubkey)?.verification ?? null; }
  async verifyProfiles(pubkeys,{fresh=false}={}) {
    if (!this.verifier || !this.settings.value.verifyNip05) return;
    await Promise.all(unique(pubkeys).filter(isHex).map(async key=>{
      const record=this.profileRecords.get(key), identifier=parseJSON(record?.event.content,{})?.nip05;
      if (!record || !identifier || typeof identifier !== 'string' || (!fresh && record.verification)) return;
      const id=record.event.id, pendingKey=`verify:${id}:${fresh}`;
      if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
      const job=(async()=>{
        const status=await this.verifier.verify(identifier,key);
        if(this.profileRecords.get(key)?.event.id!==id)return;
        const verification={...status,eventId:id,pubkey:key,identifier};
        const saved=await this.profileCache.put(record.event,{verification});
        if(this.profileRecords.get(key)?.event.id===id)this.installProfile(saved);
      })().finally(()=>this.pending.delete(pendingKey));
      this.pending.set(pendingKey,job);return job;
    }));
  }
  readRelays(all = false) { const s = this.settings.value; return [...(all ? s.relays : s.relays.slice(0, s.readRelayCount))]; }
  async accept(event) {
    if (!event?.id) return;
    if (event.kind === 0 && this.profileRecords.has(event.pubkey)) return;
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
    const generation = this.generation;
    const result = await this.network.query({relays, filters, profileBatch, gap: this.settings.value.requestGapMs});
    if (retain && generation === this.generation) await Promise.all(result.events.map(e => this.accept(e)));
    if (result.errors?.length) this.emit('warning', result.errors.map(e => `${e.relay}: ${e.reason}`).join('\n'));
    return result;
  }
  peekProfile(pubkey) {
    const p = parseJSON(this.replacements.get(`0:${pubkey}`)?.content, {});
    return p && !Array.isArray(p) && typeof p === 'object' ? p : {};
  }
  knownProfile(pubkey) {
    const record=this.profileRecords.get(pubkey);
    if(!record)return null;
    this.profileRecords.delete(pubkey);this.profileRecords.set(pubkey,record);
    return record.event;
  }
  async rememberProfiles(events, relays, {fresh=false}={}) {
    for(const pubkey of unique(events.filter(e=>e.kind===0).map(e=>e.pubkey))) {
      const event=latest([...events.filter(e=>e.kind===0&&e.pubkey===pubkey),this.replacements.get(`0:${pubkey}`)]);
      if(!validProfile(event) || (!fresh && this.profileRecords.has(pubkey)))continue;
      const saved=await this.profileCache.put(event,{replace:fresh});
      this.installProfile(saved);
    }
  }
  async profile(pubkey, options = {}) {
    const event=await this.replacement(0, pubkey, options.fresh?{...options,required:true}:options);
    if(options.fresh&&!validProfile(event))throw new Error('有効なプロフィールを取得できませんでした。保存済みの情報は変更していません');
    await this.verifyProfiles([pubkey],{fresh:!!options.fresh});
    return this.peekProfile(pubkey);
  }
  async profiles(pubkeys, options = {}) {
    await Promise.all(unique(pubkeys).filter(isHex).map(p => this.replacement(0, p, options)));
    await this.verifyProfiles(pubkeys,{fresh:!!options.fresh});
  }

  /** The profile path and the feed decoration path share in-progress reads. */
  async replacementRead(kind, pubkey, {all = false, fresh = false, required = false} = {}) {
    if (!isHex(pubkey)) return Promise.reject(new Error('公開鍵が不正です'));
    const relays = this.readRelays(all);
    if (kind === 0) await this.cachedProfiles([pubkey]);
    // Writes/all-relay reads must NEVER be satisfied from session metadata.
    const known = kind === 0 && !fresh && !all && !required ? this.knownProfile(pubkey, relays) : null;
    if (known) return Promise.resolve({...emptyResult(), events: [known]});
    const key = `replace:${this.generation}:${relayScope(relays)}:${kind}:${pubkey}:${fresh}:${required}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.batchQuery([{kinds: [kind], authors: [pubkey], limit: 1}], relays, {fresh})
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise); return promise;
  }
  async replacement(kind, pubkey, options = {}) {
    const result = await this.replacementRead(kind, pubkey, options);
    if (options.required && !result.complete) throw new Error('最新のデータを全リレーで確認できませんでした。既存の設定を消さないため変更を中止しました');
    // An absent/failed forced read is not replaced with an old response.
    return latest(result.events.filter(e => e.kind === kind && e.pubkey === pubkey));
  }
  batchQuery(filters, relays = this.readRelays(), {fresh=false}={}) {
    if (!filters.length) return Promise.resolve(emptyResult());
    return new Promise(resolve => {
      this.batchQueue.push({filters, relays, fresh, generation: this.generation, resolve});
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
        if(generation!==this.generation){for(const item of group)item.resolve({...emptyResult(),complete:false});return;}
        const filters = compactProfileFilters(group.flatMap(item => item.filters));
        const result = await this.query(filters, {relays, profileBatch: true, retain: false});
        if (generation === this.generation) {
          await Promise.all(result.events.map(event => this.accept(event)));
          // An explicit successful refresh may replace only the requested profiles.
          // Valid positive partial metadata can be stored, but never a missing result.
          const forced=new Set(group.filter(item=>item.fresh).flatMap(item=>item.filters.filter(f=>f.kinds?.includes(0)).flatMap(f=>f.authors)));
          await this.rememberProfiles(result.events.filter(e=>!forced.has(e.pubkey)), relays);
          if(result.complete)await this.rememberProfiles(result.events.filter(e=>forced.has(e.pubkey)),relays,{fresh:true});
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
    await this.cachedProfiles(authors);
    const reads = authors.map(author => this.replacementRead(0, author));
    if (isHex(pubkey) && ids.length) {
      const filters = chunks(ids, LIMITS.page).map(group => ({
        kinds: [7], authors: [pubkey], '#e': group, limit: Math.min(60, group.length * 2)
      }));
      reads.push(this.batchQuery(filters));
    }
    const results = await Promise.all(reads);
    await this.verifyProfiles(authors);
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
    if (event.kind === 0) { await this.rememberProfiles([event], this.readRelays(),{fresh:true}); await this.verifyProfiles([event.pubkey]); }
    this.emit('published', event);
  }
}
