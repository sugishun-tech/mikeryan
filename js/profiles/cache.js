import { storagePrefix, LIMITS } from '../core/config.js?v=1.2.0';
import { isHex, parseJSON, compareEvents } from '../core/utils.js?v=1.2.0';
import { verifyEvent, validEventShape } from '../core/crypto.js?v=1.2.0';

export function validProfile(event) {
  const value = parseJSON(event?.content);
  return event?.kind === 0 && validEventShape(event) && value !== null &&
    typeof value === 'object' && !Array.isArray(value) &&
    new TextEncoder().encode(JSON.stringify(event)).length <= LIMITS.eventBytes;
}
function browserStorage(name) {
  try { return globalThis[name]; } catch { return undefined; }
}
function validRecord(record, pubkey) {
  return record?.version === 1 && record.event?.pubkey === pubkey && validProfile(record.event);
}
export function profileVerification(record) {
  const v = record?.verification, event = record?.event;
  const identifier = parseJSON(event?.content, {})?.nip05;
  return v && v.eventId === event?.id && v.pubkey === event?.pubkey &&
    v.identifier === identifier && ['valid','invalid','unknown'].includes(v.state) ? v : null;
}

/** Only kind:0 and its dated NIP-05 verification can enter this store.
 * No expiry, polling, relay-list, post, or query-result cache. IndexedDB writes
 * compare within one transaction, so two tabs cannot silently downgrade metadata.
 */
export class ProfileCache {
  constructor({name = `${storagePrefix()}profiles`, indexedDB = browserStorage('indexedDB'),
    localStorage = browserStorage('localStorage'), onError = () => {}, verify = verifyEvent} = {}) {
    this.name = name; this.idb = indexedDB; this.local = localStorage; this.onError = onError;
    this.verify = verify; this.memory = new Map(); this.dbPromise = null;
    this.rejected = new Set(); this.failed = false; this.mode = indexedDB ? 'indexeddb' : localStorage ? 'localstorage' : 'memory';
    this.stats = {hits:0, misses:0, writes:0, failures:0};
  }
  warn(error) {
    this.stats.failures++;
    if (!this.failed) { this.failed = true; this.onError(error); }
  }
  async database() {
    if (!this.idb) return null;
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      let request, settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('プロフィール保存領域を開けませんでした')); } }, 3000);
      try { request = this.idb.open(this.name, 1); } catch(error) { clearTimeout(timer); reject(error); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('profiles')) request.result.createObjectStore('profiles', {keyPath:'pubkey'}); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; } settled = true; clearTimeout(timer);
        const db = request.result; db.onversionchange = () => { db.close(); this.dbPromise = null; }; resolve(db);
      };
      request.onerror = () => { settled = true; clearTimeout(timer); reject(request.error); };
    }).catch(error => { this.idb = null; this.mode = this.local ? 'localstorage' : 'memory'; this.warn(error); return null; });
    return this.dbPromise;
  }
  async raw(pubkey) {
    const db = await this.database();
    if (db) return new Promise((resolve, reject) => {
      const tx = db.transaction('profiles','readonly'), req = tx.objectStore('profiles').get(pubkey);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    if (this.local) return parseJSON(this.local.getItem(`${this.name}:${pubkey}`));
    return this.memory.get(pubkey);
  }
  async get(pubkey) {
    if (!isHex(pubkey)) return null;
    try {
      const record = await this.raw(pubkey);
      if (!validRecord(record, pubkey) || !await this.verify(record.event)) { if(record?.event?.id)this.rejected.add(`${pubkey}:${record.event.id}`);this.stats.misses++; return null; }
      this.stats.hits++; return {...record, verification:profileVerification(record)};
    } catch(error) { this.warn(error); this.stats.misses++; return null; }
  }
  async put(event, {replace = false, verification} = {}) {
    if (!validProfile(event)) throw new Error('永続保存できるのは有効なkind:0プロフィールだけです');
    const incoming = {version:1, pubkey:event.pubkey, event, savedAt:Date.now(), verification:null};
    if (verification) incoming.verification = profileVerification({...incoming,verification});
    const choose = old => {
      if (!validRecord(old,event.pubkey) || this.rejected.has(`${event.pubkey}:${old.event.id}`)) return incoming;
      if (old.event.id === event.id) return {...old, verification:incoming.verification ?? old.verification};
      if (!replace || compareEvents(old.event,event) < 0) return old;
      return incoming;
    };
    try {
      const db = await this.database(); let chosen;
      if (db) chosen = await new Promise((resolve,reject) => {
        const tx = db.transaction('profiles','readwrite'), store = tx.objectStore('profiles'), req = store.get(event.pubkey);
        let record;
        req.onsuccess = () => { record = choose(req.result); store.put(record); };
        tx.oncomplete = () => resolve(record); tx.onabort = () => reject(tx.error ?? new Error('プロフィールの保存が中断されました'));
        tx.onerror = () => {};
      });
      else {
        chosen = choose(await this.raw(event.pubkey));
        if (this.local) this.local.setItem(`${this.name}:${event.pubkey}`,JSON.stringify(chosen));
        else { this.memory.set(event.pubkey,chosen); this.warn(new Error('永続保存が利用できません')); }
      }
      this.stats.writes++; return {...chosen,verification:profileVerification(chosen)};
    } catch(error) {
      // Current-screen data still works; never pretend a failed write persisted.
      this.warn(error); return incoming;
    }
  }
  async close() { const db = this.dbPromise ? await this.dbPromise : null; db?.close(); this.dbPromise = null; }
}
