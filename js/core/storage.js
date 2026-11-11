import { storagePrefix } from './config.js?v=1.3.5';
/** Authored sends, reaction reply receipts, and relay cooldowns. Never read responses. */
export class Storage {
  constructor(name = 'state') {
    this.prefix = `${storagePrefix()}${name}:`; this.memory = new Map(); this.unsaved = new Set();
  }
  check(key) {
    if (!/^(outbox|health|reaction-replies):/.test(key)) throw new Error('取得データは保存しません');
  }
  async get(key) {
    this.check(key);
    if (key.startsWith('reaction-replies:') && this.unsaved.has(key))
      throw new Error('いいねの送信記録の保存に失敗しています。保存設定・容量を確認して再読み込みしてください');
    let record = this.memory.get(key);
    // A local failed write is newer than disk. Otherwise disk (including a
    // deletion made by another tab) is authoritative, not our previous copy.
    if (!this.unsaved.has(key)) {
      try {
        const raw = localStorage.getItem(this.prefix + key);
        record = raw === null ? undefined : JSON.parse(raw);
        if (key.startsWith('reaction-replies:') && raw !== null && (!record || typeof record !== 'object' || Array.isArray(record)))
          throw new Error('送信記録の形式が不正です');
        if (record) this.memory.set(key, record); else this.memory.delete(key);
      } catch (error) {
        // A reaction ledger that cannot be read is not proof of an empty
        // ledger. Fail closed before a second signature can be requested.
        if (key.startsWith('reaction-replies:')) throw new Error('いいねの送信記録を読み取れません。保存設定・データを確認してください', {cause: error});
      }
    }
    if (key.startsWith('reaction-replies:') && record &&
        (record.expires !== null || !record.value || typeof record.value !== 'object' || Array.isArray(record.value)))
      throw new Error('いいねの送信記録が不正なため、送信を中止しました');
    return record && (record.expires === null || record.expires > Date.now()) ? record.value : undefined;
  }
  async set(key, value, ttl = 86400000) {
    this.check(key);
    const record = {value, expires: ttl === null ? null : Date.now() + ttl}; this.memory.set(key, record);
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
