import { Storage } from '../core/storage.js?v=1.3.0';
import { RelayPool } from './pool.js?v=1.3.0';
export class NetworkClient {
  constructor() { this.worker = null; this.localPool = null; this.pending = new Map(); this.counter = 0; this.mode = 'starting'; this.ready = this.init(); }
  fallback(error, worker = this.worker) {
    if (worker !== this.worker) return;
    this.worker = null;
    try { worker?.port.close(); } catch { /* A failed message port may already be closed. */ }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.localPool ??= new RelayPool(new Storage()); this.mode = 'per-tab';
    // Do not replay requests here: a signed event may already have been sent.
    // The next explicit user action can use the local pool or retry the outbox.
  }
  async init() {
    if (typeof SharedWorker !== 'undefined') {
      try {
        const worker = this.worker = new SharedWorker(new URL('./shared-worker.js?v=1.3.0', import.meta.url), { type: 'module', name: 'mikeryan-1.3.0' });
        worker.onerror = event => { event?.preventDefault?.(); this.fallback(new Error('共有通信処理が停止しました。操作を再試行してください'), worker); };
        worker.port.onmessageerror = () => this.fallback(new Error('共有通信処理の応答を読み取れませんでした。操作を再試行してください'), worker);
        worker.port.onmessage = ({ data }) => {
          if (worker !== this.worker || !data || typeof data !== 'object') return;
          const p = this.pending.get(data.id); if (!p) return;
          this.pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
        };
        worker.port.start(); await this.rpc('hello', null, 3000);
        if (worker === this.worker) { this.mode = 'shared-worker'; return; }
      } catch (error) { this.fallback(error); }
    }
    this.localPool ??= new RelayPool(new Storage()); this.mode = 'per-tab';
  }
  rpc(method, payload, timeout = 180000) {
    return new Promise((resolve, reject) => {
      if (!this.worker) { reject(new Error('共有通信処理に接続されていません')); return; }
      const id = ++this.counter, worker = this.worker;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('通信処理がタイムアウトしました。設定のリレー接続・エラーを確認してください')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { worker.port.postMessage({ id, method, payload }); }
      catch (error) { this.fallback(error, worker); }
    });
  }
  async call(method, payload) { await this.ready; return this.worker ? this.rpc(method, payload) : this.localPool[method](payload); }
  query(payload) { return this.call('query', payload); }
  publish(payload) { return this.call('publish', payload); }
  async stats() { return { ...await this.call('stats'), mode: this.mode }; }
  authInfo(payload) { return this.call('authInfo', payload); }
  authenticate(payload) { return this.call('authenticate', payload); }
}
