import { Storage } from '../core/storage.js?v=1.1.1';
import { RelayPool } from './pool.js?v=1.1.1';
export class NetworkClient {
  constructor() { this.worker = null; this.localPool = null; this.pending = new Map(); this.counter = 0; this.mode = 'starting'; this.ready = this.init(); }
  async init() {
    if (typeof SharedWorker !== 'undefined') {
      try {
        this.worker = new SharedWorker(new URL('./shared-worker.js?v=1.1.1', import.meta.url), { type: 'module', name: 'mikeryan-1.1.1' });
        this.worker.port.onmessage = ({ data }) => { const p = this.pending.get(data.id); if (!p) return; this.pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(new Error(data.error)) : p.resolve(data.result); };
        this.worker.port.start(); await this.rpc('hello', null, 3000); this.mode = 'shared-worker'; return;
      } catch { this.worker?.port.close(); this.worker = null; }
    }
    this.localPool = new RelayPool(new Storage()); this.mode = 'per-tab';
  }
  rpc(method, payload, timeout = 180000) {
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('通信処理がタイムアウトしました。設定のリレー接続・エラーを確認してください')); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.worker.port.postMessage({ id, method, payload });
    });
  }
  async call(method, payload) { await this.ready; return this.worker ? this.rpc(method, payload) : this.localPool[method](payload); }
  query(payload) { return this.call('query', payload); }
  publish(payload) { return this.call('publish', payload); }
  async stats() { return { ...await this.call('stats'), mode: this.mode }; }
  authInfo(payload) { return this.call('authInfo', payload); }
  authenticate(payload) { return this.call('authenticate', payload); }
}
