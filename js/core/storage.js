import { LIMITS, storagePrefix } from './config.js';
export class Storage {
  constructor(name = `${storagePrefix()}cache`) { this.name = name; this.writes=0; this.pruning=null; this.memory = new Map(); this.db = null; this.persistent = false; this.ready = this.open(); }
  open() {
    if (!globalThis.indexedDB) return Promise.resolve();
    return new Promise(resolve => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
      request.onsuccess = () => { this.db = request.result; this.persistent = true; this.db.onversionchange = () => this.db.close(); resolve(); };
      request.onerror = request.onblocked = () => resolve();
    });
  }
  async record(key) {
    await this.ready;
    if (!this.db) return this.memory.get(key) ?? null;
    return new Promise(resolve => {
      try {
        const req = this.db.transaction('records').objectStore('records').get(key);
        req.onsuccess = () => resolve(req.result ?? null); req.onerror = () => resolve(this.memory.get(key) ?? null);
      } catch { resolve(this.memory.get(key) ?? null); }
    });
  }
  async get(key, stale = false) { const r = await this.record(key); return r && (stale || r.expires > Date.now()) ? r.value : undefined; }
  async set(key, value, ttl = 86400000) {
    await this.ready;
    const record = { key, value, updated: Date.now(), expires: Date.now() + ttl };
    this.memory.set(key, record);
    if (this.memory.size > 1000) this.memory.delete(this.memory.keys().next().value);
    if (!this.db) return;
    await new Promise(resolve => {
      try { const tx = this.db.transaction('records', 'readwrite'); tx.objectStore('records').put(record); tx.oncomplete = tx.onerror = tx.onabort = () => resolve(); } catch { resolve(); }
    });
    if(++this.writes % 500 === 0 && !this.pruning) this.pruning=this.prune().catch(()=>{}).finally(()=>{this.pruning=null;});
  }
  async delete(key) {
    this.memory.delete(key); await this.ready;
    if (this.db) await new Promise(resolve => { try { const tx = this.db.transaction('records', 'readwrite'); tx.objectStore('records').delete(key); tx.oncomplete = tx.onerror = () => resolve(); } catch { resolve(); } });
  }
  async clear() {
    this.memory.clear(); await this.ready;
    if (this.db) await new Promise(resolve => { const tx = this.db.transaction('records', 'readwrite'); tx.objectStore('records').clear(); tx.oncomplete = tx.onerror = () => resolve(); });
  }
  async prune() {
    await this.ready; if (!this.db) return;
    // A bounded local cache, not an unbounded mirror of relay history.
    const records = await new Promise(resolve => { const req = this.db.transaction('records').objectStore('records').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => resolve([]); });
    const live = records.filter(r => r.expires > Date.now()).sort((a, b) => b.updated - a.updated);
    const keep = new Set(live.slice(0, LIMITS.maxRecords).map(r => r.key));
    await new Promise(resolve => { const tx = this.db.transaction('records', 'readwrite'); for (const r of records) if (!keep.has(r.key)) tx.objectStore('records').delete(r.key); tx.oncomplete = tx.onerror = () => resolve(); });
  }
}
export const local = {
  get(key) { try { return localStorage.getItem(storagePrefix() + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(storagePrefix() + key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(storagePrefix() + key); } catch {} }
};
