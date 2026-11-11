import { APP_NAME, storagePrefix } from '../core/config.js?v=1.3.5';
import { Emitter, isHex, normalizeRelay, unique } from '../core/utils.js?v=1.3.5';
import { verifyEvent } from '../core/crypto.js?v=1.3.5';

const LOOKUP_LIMIT = 100;
const lastTag = (event, name) => Array.isArray(event?.tags)
  ? event.tags.filter(tag => Array.isArray(tag) && tag[0] === name).at(-1) : undefined;
const targetId = event => lastTag(event, 'e')?.[1];
const incoming = (event, pubkey) => isHex(pubkey) && event?.kind === 7 &&
  isHex(event.id) && isHex(event.pubkey) && event.pubkey !== pubkey &&
  typeof event.content === 'string' && lastTag(event, 'p')?.[1] === pubkey && isHex(targetId(event));
const likes = (event, target, pubkey) => event?.kind === 7 && event.pubkey === pubkey &&
  (event.content === '+' || event.content === '') && targetId(event) === target.id;
const accepted = record => record.results.some(result => result.accepted);
const recordKey = pubkey => `reaction-replies:${pubkey}`;

/** Only manually requested likes of incoming kind:7 notifications.
 * NIP-25 does not make reactions unique by target. Persist our exact signed
 * event before transport, and serialize the read/check/sign/write across tabs.
 * Fetched reactions remain view-local; this ledger contains authored sends only.
 */
export class ReactionReplies extends Emitter {
  #send;
  constructor(social, send) {
    super(); this.social = social; this.#send = send;
    this.states = new Map(); this.targets = new Map(); this.jobs = new Map();
    this.queue = Promise.resolve(); this.generation = 0;
    // A second tab may finish a send while this notification is already visible.
    globalThis.window?.addEventListener?.('storage', event => {
      const pubkey = this.social.session.pubkey;
      if (event.key !== this.social.storage.prefix + recordKey(pubkey)) return;
      void this.restoreVisible().catch(() => {});
    });
  }
  beginView() { this.generation++; this.states.clear(); this.targets.clear(); }
  eligible(event) { return incoming(event, this.social.session.pubkey); }
  key(event, pubkey = this.social.session.pubkey) { return `${pubkey}:${event.id}`; }
  state(event) { return this.states.get(this.key(event)) ?? {status: 'idle'}; }
  setState(target, pubkey, status, extra = {}) {
    const previous = this.states.get(this.key(target, pubkey));
    if (previous?.status === 'liked' && status !== 'liked') return previous;
    const state = {status, ...extra};
    this.states.set(this.key(target, pubkey), state);
    this.emit('change', {targetId: target.id, pubkey, ...state});
    return state;
  }
  relays() {
    const relays = unique(this.social.settings.value.relays.map(normalizeRelay));
    if (!relays.length || relays.includes(null)) throw new Error('送信先リレーが不正です');
    return relays;
  }
  async records(pubkey) {
    const records = await this.social.storage.get(recordKey(pubkey));
    if (records === undefined) return {};
    if (!records || typeof records !== 'object' || Array.isArray(records))
      throw new Error('いいねの送信記録を読み取れません。重複を防ぐため送信を中止しました');
    return records;
  }
  async save(pubkey, records, required = false) {
    // No expiration or FIFO eviction: a lost OK must never become a new like.
    const saved = await this.social.storage.set(recordKey(pubkey), records, null);
    if (saved !== true) {
      if (required) throw new Error('いいねの送信記録を永続保存できないため、送信を中止しました');
      this.social.emit('notice', 'いいねの送信結果を永続保存できません。保存済みの同じイベントから確認・再送できます');
    }
  }
  async validateRecord(record, pubkey, id) {
    const target = record?.target, event = record?.event;
    const tags = Array.isArray(event?.tags) ? event.tags : [];
    const exact = name => tags.filter(tag => tag[0] === name);
    if (!incoming(target, pubkey) || target.id !== id || !likes(event, target, pubkey) ||
        event.content !== '+' || exact('e').length !== 1 || exact('p').length !== 1 ||
        exact('p')[0][1] !== target.pubkey || exact('k').length !== 1 || exact('k')[0][1] !== '7' ||
        tags.some(tag => !['e', 'p', 'k', 'client'].includes(tag[0])) ||
        !Array.isArray(record.results) || !record.results.length ||
        record.results.some(result => !normalizeRelay(result?.relay) || typeof result.accepted !== 'boolean') ||
        !await verifyEvent(target) || !await verifyEvent(event)) {
      throw new Error('いいねの送信記録を検証できません。新しいいいねは作成しません');
    }
    return record;
  }
  async restoreVisible() {
    const context = this.social.sessionContext(), generation = this.generation;
    if (!context.pubkey) return;
    const records = await this.records(context.pubkey);
    for (const target of this.targets.values()) {
      if (!incoming(target, context.pubkey) || !records[target.id]) continue;
      const record = await this.validateRecord(records[target.id], context.pubkey, target.id);
      if (!this.social.sameSession(context) || generation !== this.generation) return;
      this.setState(target, context.pubkey, accepted(record) ? 'liked' : 'pending', {event: record.event});
    }
  }
  async lookup(targets, context, relays) {
    // A bounded page-wide read for display. like() always repeats this for just
    // its one target, inside the cross-tab lock, immediately before signing.
    const result = await this.social.repo.query([{
      kinds: [7], authors: [context.pubkey], '#e': targets.map(target => target.id), limit: LOOKUP_LIMIT
    }], {relays, retain: false});
    this.social.checkSession(context);
    const found = new Map();
    for (const event of result.events ?? []) {
      const target = targets.find(target => likes(event, target, context.pubkey));
      if (target && await verifyEvent(event)) found.set(target.id, event);
    }
    this.social.checkSession(context);
    return {found, complete: result.complete === true && (result.events?.length ?? 0) < LOOKUP_LIMIT};
  }
  async prepare(events) {
    const context = this.social.sessionContext(), generation = this.generation;
    const targets = [...new Map(events.filter(event => incoming(event, context.pubkey)).map(event => [event.id, event])).values()];
    if (!targets.length) return;
    const live = () => this.social.sameSession(context) && generation === this.generation;
    const pending = [];
    try {
      const records = await this.records(context.pubkey);
      if (!live()) return;
      for (const target of targets) {
        this.targets.set(this.key(target, context.pubkey), target);
        if (this.jobs.has(this.key(target, context.pubkey))) continue;
        // Already verified positive evidence remains valid even if a relay
        // later omits it. This client does not offer an unlike operation.
        if (this.state(target).status === 'liked') continue;
        if (records[target.id]) {
          const record = await this.validateRecord(records[target.id], context.pubkey, target.id);
          if (!live()) return;
          this.setState(target, context.pubkey, accepted(record) ? 'liked' : 'pending', {event: record.event});
          if (accepted(record)) continue;
        } else this.setState(target, context.pubkey, 'checking');
        pending.push(target);
      }
      if (!pending.length) return;
      const result = await this.lookup(pending, context, this.relays());
      if (!live()) return;
      for (const target of pending) {
        if (this.jobs.has(this.key(target, context.pubkey))) continue;
        // A storage event or a send in this tab may have confirmed the like
        // after this read began. A stale negative must not undo that fact.
        if (this.state(target).status === 'liked') continue;
        const found = result.found.get(target.id);
        if (found) this.setState(target, context.pubkey, 'liked', {event: found});
        else if (this.state(target).status === 'pending') continue;
        else if (records[target.id]) this.setState(target, context.pubkey, 'pending', {event: records[target.id].event});
        else if (result.complete) this.setState(target, context.pubkey, 'idle');
        else this.setState(target, context.pubkey, 'error', {error: '送信済みか確認できませんでした。クリックすると再確認します'});
      }
    } catch (error) {
      if (live()) for (const target of targets) {
        if (this.jobs.has(this.key(target, context.pubkey)) || ['liked', 'pending'].includes(this.state(target).status)) continue;
        this.setState(target, context.pubkey, 'error', {error: error.message});
      }
      throw error;
    }
  }
  exclusive(context, task) {
    const run = this.queue.then(async () => {
      this.social.checkSession(context);
      const locks = globalThis.navigator?.locks;
      if (!locks?.request) throw new Error('重複送信の防止にはWeb Locks対応ブラウザーとHTTPS接続が必要です');
      return locks.request(`${storagePrefix()}reaction-replies:${context.pubkey}`, async () => {
        this.social.checkSession(context);
        return task();
      });
    });
    this.queue = run.catch(() => {});
    return run;
  }
  like(event) {
    const context = this.social.sessionContext();
    if (!incoming(event, context.pubkey)) return Promise.reject(new Error('自分宛てのいいね・リアクションだけにいいねを返せます'));
    const target = structuredClone(event), key = this.key(target, context.pubkey);
    if (this.jobs.has(key)) return this.jobs.get(key);
    const known = this.states.get(key);
    if (known?.status === 'liked') return Promise.resolve(known.event);
    this.targets.set(key, target);
    this.setState(target, context.pubkey, 'checking');
    const job = this.exclusive(context, async () => {
      if (!await verifyEvent(target)) throw new Error('受信リアクションの署名を検証できません');
      this.social.checkSession(context);
      const records = await this.records(context.pubkey), existing = records[target.id];
      this.social.checkSession(context);
      if (existing) {
        await this.validateRecord(existing, context.pubkey, target.id);
        this.social.checkSession(context);
        this.setState(target, context.pubkey, accepted(existing) ? 'liked' : 'pending', {event: existing.event});
        if (!accepted(existing)) throw new Error('このリアクションへのいいねは送信済みで結果未確認です。設定の「未完了の送信」から同じイベントを再送してください');
        return existing.event;
      }
      const relays = this.relays(), known = await this.lookup([target], context, relays);
      if (known.found.has(target.id)) {
        const found = known.found.get(target.id);
        this.setState(target, context.pubkey, 'liked', {event: found});
        return found;
      }
      if (!known.complete) throw new Error('既存のいいねを全リレーで確認できません。重複を防ぐため送信を中止しました');
      // #p alone is not proof of the referenced event's author. Confirm the
      // direct target, not an ancestor whose p tag was copied by an old client.
      const id = targetId(target), cached = this.social.repo.events?.get(id);
      const original = cached ?? (await this.social.repo.query([{ids: [id], limit: 1}], {relays, retain: false})).events.find(item => item.id === id);
      this.social.checkSession(context);
      if (!original || original.id !== id || original.pubkey !== context.pubkey || !await verifyEvent(original))
        throw new Error('自分の投稿へのリアクションであることを確認できないため、送信を中止しました');
      this.social.checkSession(context);
      // No invented relay hint: notification retrieval does not retain source
      // provenance. NIP-25 allows the hint to be omitted. Do not copy parent tags.
      const template = {kind: 7, content: '+', tags: [
        ['e', target.id, '', target.pubkey], ['p', target.pubkey], ['k', '7'], ['client', APP_NAME]
      ]};
      this.setState(target, context.pubkey, 'sending');
      const signed = await this.social.session.sign(structuredClone(template));
      this.social.checkSession(context);
      if (signed?.pubkey !== context.pubkey || signed.kind !== template.kind || signed.content !== '+' ||
          JSON.stringify(signed.tags) !== JSON.stringify(template.tags) || !await verifyEvent(signed))
        throw new Error('いいねの署名結果が依頼内容と一致しません');
      this.social.checkSession(context);
      const record = {event: signed, target, time: Date.now(), results: relays.map(relay => ({relay, accepted: false, reason: '送信結果を確認中'}))};
      records[target.id] = record;
      await this.save(context.pubkey, records, true);
      this.setState(target, context.pubkey, 'pending', {event: signed});
      this.social.checkSession(context);
      return this.deliver(record, records, context, relays);
    }).catch(error => {
      const current = this.states.get(key);
      if (!['liked', 'pending'].includes(current?.status)) this.setState(target, context.pubkey, 'error', {error: error.message});
      throw error;
    }).finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); });
    this.jobs.set(key, job);
    return job;
  }
  async deliver(record, records, context, relays) {
    const {event, target} = record;
    this.setState(target, context.pubkey, 'sending');
    try {
      return await this.#send(event, relays, record.results.filter(result => result.accepted), async result => {
        record.results = result.results;
        await this.save(context.pubkey, records);
        this.setState(target, context.pubkey, accepted(record) ? 'liked' : 'pending', {event});
      });
    } catch (error) {
      this.setState(target, context.pubkey, accepted(record) ? 'liked' : 'pending', {event});
      throw error;
    }
  }
  async pendingRows() {
    const context = this.social.sessionContext();
    if (!context.pubkey) return [];
    const records = await this.records(context.pubkey), rows = [];
    for (const [id, record] of Object.entries(records)) {
      await this.validateRecord(record, context.pubkey, id);
      if (record.results.some(result => !result.accepted)) rows.push(record);
    }
    this.social.checkSession(context);
    return rows.sort((a, b) => b.time - a.time);
  }
  retry(event) {
    const context = this.social.sessionContext();
    if (event?.pubkey !== context.pubkey || event.kind !== 7) return Promise.reject(new Error('自分が送信したいいねだけを再送できます'));
    const id = targetId(event), key = `${context.pubkey}:${id}`;
    if (this.jobs.has(key)) return this.jobs.get(key);
    const job = this.exclusive(context, async () => {
      const records = await this.records(context.pubkey), record = records[id];
      await this.validateRecord(record, context.pubkey, id);
      this.social.checkSession(context);
      if (record.event.id !== event.id) throw new Error('保存済みのいいねとイベントIDが一致しません');
      const relays = record.results.filter(result => !result.accepted).map(result => result.relay);
      if (!relays.length) return record.event;
      // A previous failed storage write can be available only in this tab's
      // memory. Re-establish durable recovery before any retry reaches a relay.
      await this.save(context.pubkey, records, true);
      this.social.checkSession(context);
      // Retry the already authorized bytes; never call the signer again.
      return this.deliver(record, records, context, relays);
    }).finally(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); });
    this.jobs.set(key, job);
    return job;
  }
}
