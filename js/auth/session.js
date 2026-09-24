import { Emitter, isHex, sleep, nowSeconds } from '../core/utils.js?v=1.1.1';
import { local } from '../core/storage.js?v=1.1.1';
import { verifyEvent } from '../core/crypto.js?v=1.1.1';
export class Session extends Emitter {
  constructor() { super(); this.pubkey = null; this.connected = false; this.queue = Promise.resolve(); this.loginPromise = null; }
  restore() {
    let key = local.get('pubkey');
    if (!key && !local.get('logged-out')) {
      try { key = localStorage.getItem('nostr_profile_viewer_last_login_pubkey'); } catch {}
    }
    if (isHex(String(key).toLowerCase())) { this.pubkey = key.toLowerCase(); local.set('pubkey', this.pubkey); }
    this.emit('change', this.pubkey); return this.pubkey;
  }
  async extension() {
    for (let i=0;i<10;i++) { if (window.nostr?.getPublicKey && window.nostr?.signEvent) return window.nostr; await sleep(100); }
    throw new Error('NIP-07拡張機能が見つかりません。nos2xやAlbyなどを有効にしてください');
  }
  async login() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      const extension = await this.extension(); const pubkey = String(await extension.getPublicKey()).toLowerCase();
      if (!isHex(pubkey)) throw new Error('拡張機能が不正な公開鍵を返しました');
      this.pubkey = pubkey; this.connected = true; local.set('pubkey', pubkey); local.remove('logged-out'); this.emit('change', pubkey); return pubkey;
    })().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }
  logout() { this.pubkey = null; this.connected = false; local.remove('pubkey'); local.set('logged-out','1'); this.emit('change',null); }
  sign(template) {
    const requestedKey = this.pubkey;
    const run = this.queue.then(async () => {
      const expectedKey = requestedKey;
      if (this.pubkey !== expectedKey) throw new Error('署名待ちの間にアカウントが変更されました');
      if (!expectedKey) throw new Error('ログインしてください');
      const extension = await this.extension();
      if (!this.connected) {
        const actual = String(await extension.getPublicKey()).toLowerCase();
        if (actual !== expectedKey) throw new Error('拡張機能のアカウントが保存済みアカウントと異なります。設定からアカウントを切り替えてください');
        this.connected = true;
      }
      const unsigned = { created_at: nowSeconds(), ...template };
      const signed = await extension.signEvent(structuredClone(unsigned));
      if (signed.pubkey !== expectedKey || this.pubkey !== expectedKey || signed.kind !== unsigned.kind || signed.created_at !== unsigned.created_at || signed.content !== unsigned.content || JSON.stringify(signed.tags) !== JSON.stringify(unsigned.tags) || !await verifyEvent(signed)) throw new Error('署名結果が依頼内容またはログイン中の公開鍵と一致しません');
      return signed;
    });
    this.queue = run.catch(() => {}); return run;
  }
}
