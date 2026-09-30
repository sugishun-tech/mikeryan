import { storagePrefix } from './config.js?v=1.3.0';
/** User-authored pending sends and relay cooldowns only. Never a read-response store. */
export class Storage {
  constructor(name = 'state') {
    this.prefix = `${storagePrefix()}${name}:`; this.memory = new Map(); this.unsaved = new Set();
  }
  check(key) {
    if (!/^(outbox|health):/.test(key)) throw new Error('取得データは保存しません');
  }
  async get(key) {
    this.check(key);
    let record = this.memory.get(key);
    // A local failed write is newer than disk. Otherwise disk (including a
    // deletion made by another tab) is authoritative, not our previous copy.
    if (!this.unsaved.has(key)) {
      try {
        record = JSON.parse(localStorage.getItem(this.prefix + key));
        if (record) this.memory.set(key, record); else this.memory.delete(key);
      } catch {}
    }
    return record && record.expires > Date.now() ? record.value : undefined;
  }
  async set(key, value, ttl = 86400000) {
    this.check(key);
    const record = {value, expires: Date.now() + ttl}; this.memory.set(key, record);
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(record)); this.unsaved.delete(key); return true;
    } catch { this.unsaved.add(key); return false; }
  }
  async delete(key) {
    this.check(key); this.memory.delete(key);
    try { localStorage.removeItem(this.prefix + key); this.unsaved.delete(key); return true; }
    catch { this.unsaved.add(key); return false; }
  }
}
export const local = {
  get(key) { try { return localStorage.getItem(storagePrefix() + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(storagePrefix() + key, value); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(storagePrefix() + key); } catch {} }
};
