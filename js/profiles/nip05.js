import { isHex, Emitter } from '../core/utils.js?v=1.2.0';
export function parseIdentifier(value) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const match = value.trim().match(/^([a-z0-9._-]+)@([a-z0-9.-]+)$/i);
  if (!match) return null;
  const [,name,rawDomain] = match, domain = rawDomain.toLowerCase();
  if (!domain.includes('.') || domain.length > 253 || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
  if (/^\d+(\.\d+){3}$/.test(domain) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(domain)) return null;
  return { name, domain, normalized: `${name}@${domain}`, url: `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}` };
}
export class Nip05 extends Emitter {
  constructor(storage, { fetcher = (...args) => fetch(...args) } = {}) { super(); this.fetcher = fetcher; this.inflight = new Map(); this.active = 0; this.waiters = []; this.requests = 0; }
  async slot() { if (this.active < 2) { this.active++; return; } await new Promise(resolve => this.waiters.push(resolve)); }
  release() { const next = this.waiters.shift(); if(next)next(); else this.active--; }
  async document(identifier) {
    const parsed = parseIdentifier(identifier); if (!parsed) return { state: 'invalid', reason: '識別子の形式が不正です' };
    const key = `nip05doc:${parsed.normalized}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = (async () => {
      await this.slot(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 6000);
      try {
        this.requests++;
        const response = await this.fetcher(parsed.url, { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Number(response.headers?.get('content-length')) > 262144) throw new Error('応答が大きすぎます');
        let text = '';
        if (response.body?.getReader) {
          const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes=0;
          while (true) { const {done,value} = await reader.read(); if(done)break; bytes+=value.byteLength; if(bytes>262144){await reader.cancel();throw new Error('応答が大きすぎます');} text+=decoder.decode(value,{stream:true}); } text+=decoder.decode();
        } else text = await response.text();
        if (text.length > 262144) throw new Error('応答が大きすぎます');
        const data = JSON.parse(text), keyValue = data?.names?.[parsed.name];
        const result = isHex(keyValue) ? { state: 'found', pubkey: keyValue, checked: Date.now() } : { state: 'invalid', reason: '公開鍵の登録が見つかりません', checked: Date.now() };
        return result;
      } catch { const result = { state: 'unknown', reason: '検証できません（通信・CORS・リダイレクトなど）', checked: Date.now() }; return result; }
      finally { clearTimeout(timer); this.release(); }
    })();
    this.inflight.set(key,task); try { return await task; } finally { this.inflight.delete(key); }
  }
  async verify(identifier, pubkey) {
    const key = `${identifier}|${pubkey}`;
    const result = await this.document(identifier);
    const status = result.state === 'found' ? { ...result, state: result.pubkey === pubkey ? 'valid' : 'invalid', reason: result.pubkey === pubkey ? 'NIP-05と公開鍵が一致しています（実在の本人であることの保証ではありません）' : 'NIP-05の公開鍵が一致しません' } : result;
    this.emit('status',{key,status}); return status;
  }
  async resolve(identifier) { const result = await this.document(identifier); if(result.state !== 'found')throw new Error(result.reason);return result.pubkey; }
}
