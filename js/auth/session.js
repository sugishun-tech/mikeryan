import { Emitter, isHex, sleep, nowSeconds } from '../core/utils.js?v=1.2.3';
import { local } from '../core/storage.js?v=1.2.3';
import { verifyEvent } from '../core/crypto.js?v=1.2.3';
export class Session extends Emitter {
  constructor() {
    super(); this.pubkey = null; this.connected = false; this.epoch = 0;
    this.queue = Promise.resolve(); this.loginPromise = null;
  }
  restore() {
    let key = local.get('pubkey');
    if (!key && !local.get('logged-out')) {
      try { key = localStorage.getItem('nostr_profile_viewer_last_login_pubkey'); } catch {}
    }
    if (isHex(String(key).toLowerCase())) { this.pubkey = String(key).toLowerCase(); local.set('pubkey', this.pubkey); }
    this.emit('change', this.pubkey); return this.pubkey;
  }
  async extension() {
    for (let i=0;i<10;i++) { if (window.nostr?.getPublicKey && window.nostr?.signEvent) return window.nostr; await sleep(100); }
    throw new Error('NIP-07拡張機能が見つかりません。nos2xやAlbyなどを有効にしてください');
  }
  async login() {
    if (this.loginPromise) return this.loginPromise;
    // A logout invalidates this attempt, even if the same key logs in again.
    const epoch = ++this.epoch;
    const attempt = (async () => {
      const extension = await this.extension();
      if (epoch !== this.epoch) throw new Error('ログイン操作はアカウント変更により中止しました');
      const pubkey = String(await extension.getPublicKey()).toLowerCase();
      if (epoch !== this.epoch) throw new Error('ログイン操作はログアウトまたはアカウント変更により中止しました');
      if (!isHex(pubkey)) throw new Error('拡張機能が不正な公開鍵を返しました');
      this.pubkey = pubkey; this.connected = true;
      local.set('pubkey', pubkey); local.remove('logged-out'); this.emit('change', pubkey); return pubkey;
    })();
    const job = attempt.finally(() => { if (this.loginPromise === job) this.loginPromise = null; });
    this.loginPromise = job; return job;
  }
  logout() {
    this.epoch++; this.loginPromise = null; this.pubkey = null; this.connected = false;
    local.remove('pubkey'); local.set('logged-out','1'); this.emit('change',null);
  }
  sign(template) {
    const expectedKey = this.pubkey, epoch = this.epoch;
    let snapshot;
    try { snapshot = structuredClone(template); } catch { return Promise.reject(new Error('署名するデータが不正です')); }
    const check = () => {
      if (this.pubkey !== expectedKey || this.epoch !== epoch) throw new Error('署名待ちの間にアカウントが変更されました');
      if (!expectedKey) throw new Error('ログインしてください');
    };
    const run = this.queue.then(async () => {
      check();
      const extension = await this.extension(); check();
      if (!this.connected) {
        const actual = String(await extension.getPublicKey()).toLowerCase(); check();
        if (actual !== expectedKey) throw new Error('拡張機能のアカウントが保存済みアカウントと異なります。設定からアカウントを切り替えてください');
        this.connected = true;
      }
      const unsigned = { created_at: nowSeconds(), ...snapshot };
      const signed = await extension.signEvent(structuredClone(unsigned)); check();
      if (!signed || signed.pubkey !== expectedKey || signed.kind !== unsigned.kind ||
          signed.created_at !== unsigned.created_at || signed.content !== unsigned.content ||
          JSON.stringify(signed.tags) !== JSON.stringify(unsigned.tags) || !await verifyEvent(signed)) {
        throw new Error('署名結果が依頼内容またはログイン中の公開鍵と一致しません');
      }
      check(); return signed;
    });
    this.queue = run.catch(() => {}); return run;
  }
}
