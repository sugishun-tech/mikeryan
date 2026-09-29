import { EventPager } from '../feed/pagination.js?v=1.2.3';
import { latest, sortEvents, unique } from '../core/utils.js?v=1.2.3';
import { pubkeys } from './service.js?v=1.2.3';

/** One manual follower directory, discarded on refresh/navigation.
 * Relay cursors are independent: an offline relay may not suppress another
 * relay's verified candidates, and must remain retryable at its own cursor.
 * Known followees are a second, bounded discovery lane. A broken #p index
 * must not make a directly verifiable mutual follow disappear.
 */
export class FollowerDirectory {
  constructor(repo, social, owner) {
    this.repo = repo; this.social = social; this.owner = owner;
    this.generation = repo.generation;
    this.streams = repo.readRelays().map(relay => {
      const stream = {relay, partial:[]};
      stream.pager = new EventPager(async filters => {
        const result = await repo.query(filters, {relays:[relay], retain:false, page:true});
        if (!result.complete) stream.partial.push(...result.events);
        return result;
      }, [{kinds:[3], '#p':[owner]}], 30);
      return stream;
    });
    this.ownerEvent = null; this.ownerAttempted = false; this.ownerComplete = false;
    this.ownChecked = new Set(); this.contacts = new Map(); this.followers = new Map();
    this.queued = new Set(); this.displayed = new Set(); this.pending = new Set();
    this.removed = new Set(); this.busy = null;
  }
  active() {
    if (this.generation !== this.repo.generation) throw new Error('表示先が変更されました');
  }
  async readOwner() {
    this.ownerAttempted = true;
    let read;
    try { read = await this.repo.replacementRead(3, this.owner); }
    catch (error) { read = {events:[], complete:false}; }
    this.active();
    const current = latest([this.ownerEvent, this.repo.replacements.get(`3:${this.owner}`), ...read.events]
      .filter(e => e?.kind === 3 && e.pubkey === this.owner));
    this.ownerEvent = current; this.ownerComplete = !!current && read.complete;
    if (current) await this.repo.accept(current);
  }
  ownRemaining() {
    const event = latest([this.ownerEvent, this.repo.replacements.get(`3:${this.owner}`)]);
    return pubkeys(event).filter(key => !this.ownChecked.has(key));
  }
  get exhausted() {
    return !this.queued.size && !this.ownRemaining().length && this.streams.every(s => s.pager.exhausted);
  }
  get needsRetry() { return this.pending.size > 0 || !this.ownerComplete; }
  get warning() {
    const warnings = this.streams.filter(s => s.pager.warning).map(s => `${s.relay}: ${s.pager.warning}`);
    if (!this.ownerComplete) warnings.push('本人のフォローリストが未確認のため、相互フォロー候補の確認が未完了です。');
    if (this.pending.size) warnings.push(`${this.pending.size}人の最新フォロー状態が未確認です。受信済みの署名付き情報は保持しています。`);
    return warnings.join(' ');
  }
  reconcile() {
    // Locally accepted kind:3 updates can arrive while fetched rows wait in a
    // display buffer. Never paint an old positive over a newer signed unfollow.
    for (const key of unique([...this.contacts.keys(), ...this.pending])) {
      const event = latest([this.contacts.get(key), this.repo.replacements.get(`3:${key}`)]);
      if (!event) continue;
      this.contacts.set(key,event);
      if (pubkeys(event).includes(this.owner)) {
        this.followers.set(key,event);
        if (!this.displayed.has(key)) this.queued.add(key);
      } else {
        this.followers.delete(key); this.queued.delete(key);
        if (this.displayed.delete(key)) this.removed.add(key);
      }
    }
  }
  next() { return this.run(false); }
  retry() { return this.run(true); }
  run(retry) {
    if (this.busy) return this.busy;
    this.busy = this.perform(retry).finally(() => { this.busy = null; });
    return this.busy;
  }
  async validate(keys, evidence = []) {
    if (!keys.length) return;
    const known = [...this.contacts.values(), ...evidence];
    let back;
    try { back = await this.social.followingBack(this.owner, keys, {evidence:known}); }
    catch (error) {
      // Unexpected/transport failure still does not erase verified candidates.
      // Leave every affected identity eligible for an explicit retry.
      this.active();
      back = new Set(); back.contacts = new Map(); back.incomplete = new Set(keys);
      for (const key of keys) {
        const event = latest([...known, this.repo.replacements.get(`3:${key}`)]
          .filter(e => e?.kind === 3 && e.pubkey === key));
        if (event) { back.contacts.set(key,event); await this.repo.accept(event); if (pubkeys(event).includes(this.owner)) back.add(key); }
      }
    }
    this.active();
    for (const key of keys) {
      const event = back.contacts?.get(key);
      if (event) this.contacts.set(key,event);
      if (back.incomplete?.has(key) || !event) this.pending.add(key); else this.pending.delete(key);
      if (back.has(key)) {
        this.followers.set(key,event);
        if (!this.displayed.has(key)) this.queued.add(key);
      } else if (event) {
        // Only a newer/equal-winning signed state can remove a follower.
        this.followers.delete(key); this.queued.delete(key);
        if (this.displayed.delete(key)) this.removed.add(key);
      }
    }
  }
  async perform(retry) {
    this.active(); this.reconcile();
    // Drain already fetched identities without any speculative extra traffic.
    if (retry) {
      if (!this.ownerComplete) await this.readOwner();
      const keys = [...this.pending].slice(0,30);
      // Rotate unresolved identities so >30 missing records can all be retried.
      keys.forEach(key => this.pending.delete(key));
      await this.validate(keys);
    } else if (!this.queued.size) {
      const ownerRead = this.ownerAttempted ? Promise.resolve() : this.readOwner();
      const [pages] = await Promise.all([Promise.all(this.streams.map(async stream => {
        if (stream.pager.exhausted) return [];
        stream.partial = [];
        try {
          const page = await stream.pager.older();
          // Membership discovery need not commit a chronological cursor. Show
          // verified positives from a timed-out response, but retry that exact
          // relay position next time rather than advancing over unseen users.
          return page.length ? page : sortEvents(stream.partial).slice(0,30);
        } catch (error) {
          stream.pager.warning = `${stream.relay}: ${error.message}`;
          return sortEvents(stream.partial).slice(0,30);
        }
      })), ownerRead]);
      this.active();
      const evidence = sortEvents(pages.flat());
      const own = this.ownRemaining().slice(0,30);
      const keys = unique([...evidence.map(e => e.pubkey), ...own]);
      await this.validate(keys, evidence);
      own.forEach(key => this.ownChecked.add(key));
    }
    this.active(); this.reconcile();
    const events = sortEvents([...this.queued].map(key => this.followers.get(key)));
    const users = events.slice(0,30).map(e => e.pubkey);
    for (const key of users) { this.queued.delete(key); this.displayed.add(key); }
    const removed = [...this.removed]; this.removed.clear();
    return {users, removed, warning:this.warning, exhausted:this.exhausted};
  }
}
