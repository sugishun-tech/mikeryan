import { LIMITS } from '../core/config.js';
import { matchesFilter, nowSeconds, sleep } from '../core/utils.js';
import { verifyEvent, validEventShape } from '../core/crypto.js';

export class RelayError extends Error {
  constructor(message, relay, partial = []) { super(message); this.name = 'RelayError'; this.relay = relay; this.partial = partial; }
}
export function cooldownFor(reason, failures = 1, random = Math.random) {
  if (/^(blocked|restricted|auth-required|pow|invalid|unsupported):/i.test(reason)) return 3600000;
  const floor = /^rate-limited:/i.test(reason) ? 60000 : 5000;
  return Math.min(3600000, floor * 2 ** Math.min(Math.max(failures - 1, 0), 8)) + Math.floor(random() * 2500);
}

/** One lazy connection per relay, one bounded request at a time, no automatic retries. */
export class RelayConnection {
  constructor(url, storage, { socketFactory = url => new WebSocket(url), verify = verifyEvent, gap = 1200, timeout = LIMITS.requestTimeout } = {}) {
    this.url = url; this.storage = storage; this.socketFactory = socketFactory; this.verify = verify;
    this.gap = gap; this.timeout = timeout; this.socket = null; this.connecting = null;
    this.queue = Promise.resolve(); this.queued = 0; this.lastSent = 0; this.sequence = 0;
    this.pending = new Map(); this.known = new Map(); this.idleTimer = null; this.challenge = null;
    this.health = { until: 0, failures: 0, reason: '' };
    this.stats = { connections: 0, requests: 0, closes: 0, publishes: 0, events: 0, invalid: 0, sentBytes: 0, receivedBytes: 0 };
    this.ready = storage.get(`health:${url}`).then(h => { if (h) this.health = h; });
  }
  async penalize(reason) {
    this.health = { failures: this.health.failures + 1, reason, until: Date.now() + cooldownFor(reason, this.health.failures + 1) };
    await this.storage.set(`health:${this.url}`, this.health, 86400000);
  }
  async succeeded() { this.health = { until: 0, failures: 0, reason: '' }; await this.storage.delete(`health:${this.url}`); }
  enqueue(task, { allowAuth = false } = {}) {
    if (this.queued >= 30) return Promise.reject(new RelayError('通信待ちが多いため、この操作を中断しました', this.url));
    this.queued++;
    const run = this.queue.then(async () => {
      await this.ready;
      if (this.health.until > Date.now() && !allowAuth) throw new RelayError(`${this.health.reason}（${Math.ceil((this.health.until - Date.now()) / 1000)}秒休止中）`, this.url);
      await sleep(Math.max(0, this.lastSent + this.gap - Date.now()));
      return task();
    });
    this.queue = run.catch(() => {}).finally(() => { this.queued--; this.armIdle(); });
    return run;
  }
  async connect() {
    clearTimeout(this.idleTimer);
    if (this.socket?.readyState === 1) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      let settled = false, socket;
      const fail = reason => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new RelayError(reason, this.url)); }
      };
      const timer = setTimeout(() => { fail('error: 接続タイムアウト'); socket?.close(); }, LIMITS.connectionTimeout);
      try { socket = this.socketFactory(this.url); this.socket = socket; } catch (e) { fail(e.message); return; }
      socket.onopen = () => { if (settled) { socket.close(); return; } settled = true; clearTimeout(timer); this.stats.connections++; resolve(); };
      socket.onmessage = event => this.onMessage(event.data);
      socket.onerror = () => fail('error: 接続できません');
      socket.onclose = () => {
        fail('error: 接続が閉じられました');
        if (this.socket === socket) { this.socket = null; this.challenge = null; }
        for (const p of [...this.pending.values()]) p.fail('error: 接続が切れました');
      };
    }).catch(async error => { await this.penalize(error.message); throw error; }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  send(message) {
    if (this.socket?.readyState !== 1) throw new RelayError('error: 接続されていません', this.url);
    const text = JSON.stringify(message); this.stats.sentBytes += new TextEncoder().encode(text).length;
    if (message[0] !== 'CLOSE') this.lastSent = Date.now();
    this.socket.send(text);
  }
  onMessage(raw) {
    if (typeof raw !== 'string' || raw.length > LIMITS.frameBytes) { this.stats.invalid++; return; }
    this.stats.receivedBytes += new TextEncoder().encode(raw).length;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    if (msg[0] === 'AUTH' && typeof msg[1] === 'string' && msg[1].length < 4096) { this.challenge = msg[1]; return; }
    const pending = this.pending.get(msg[1]);
    if (msg[0] === 'NOTICE') {
      if (typeof msg[1] === 'string' && /^(rate-limited|blocked|restricted):/i.test(msg[1])) {
        for (const p of [...this.pending.values()]) p.fail(msg[1]);
      }
      return;
    }
    if (!pending) return;
    if (msg[0] === 'EVENT' && pending.event) pending.event(msg[2]);
    else if (msg[0] === 'EOSE' && pending.eose) pending.eose();
    else if (msg[0] === 'CLOSED') pending.fail(String(msg[2] || 'error: リレーが購読を終了しました'));
    else if (msg[0] === 'OK' && pending.ok) pending.ok(msg[2] === true, String(msg[3] ?? ''));
  }
  query(filters) {
    return this.enqueue(async () => {
      await this.connect();
      return new Promise((resolve, reject) => {
        const id = `m${++this.sequence}`; const found = new Map(); let closed = false;
        let verification = Promise.resolve(), received = 0;
        const maximum = Math.min(6000, Math.max(1, filters.reduce((n,f) => n + (f.limit || 30), 0)) * 2);
        const finish = async (error = null) => {
          if (closed) return; closed = true; clearTimeout(timer); this.pending.delete(id);
          if (this.socket?.readyState === 1) { try { this.send(['CLOSE', id]); this.stats.closes++; } catch {} }
          await verification;
          if (error) { await this.penalize(error); reject(new RelayError(error, this.url, [...found.values()])); }
          else { await this.succeeded(); resolve([...found.values()]); }
        };
        const timer = setTimeout(() => finish('error: EOSEタイムアウト'), this.timeout);
        this.pending.set(id, {
          fail: reason => void finish(reason), eose: () => void finish(),
          event: event => {
            if (closed) return;
            if (++received > maximum) { void finish('restricted: 応答件数の上限を超えました'); return; }
            if (!validEventShape(event) || event.created_at > nowSeconds() + 600 || !filters.some(f => matchesFilter(event, f))) { this.stats.invalid++; return; }
            // A known id always resolves to the previously verified object, never to an unverified replacement.
            const known = this.known.get(event.id);
            if (known) { if (filters.some(f => matchesFilter(known, f))) found.set(known.id, known); return; }
            verification = verification.then(async () => {
              if (await this.verify(event)) {
                this.known.set(event.id, event); if (this.known.size > 4000) this.known.delete(this.known.keys().next().value);
                found.set(event.id, event); this.stats.events++;
              } else this.stats.invalid++;
            });
          }
        });
        try { this.send(['REQ', id, ...filters]); this.stats.requests++; }
        catch (e) { void finish(e.message); }
      });
    });
  }
  publish(event, auth = false) {
    return this.enqueue(async () => {
      await this.connect();
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = async (success, reason) => {
          if (finished) return; finished = true; clearTimeout(timer); this.pending.delete(event.id);
          if (success || /^duplicate:/i.test(reason)) { await this.succeeded(); resolve({ relay: this.url, accepted: true }); }
          else { await this.penalize(reason); reject(new RelayError(reason, this.url)); }
        };
        const timer = setTimeout(() => finish(false, 'error: OK応答タイムアウト'), LIMITS.publishTimeout);
        this.pending.set(event.id, { fail: reason => void finish(false, reason), ok: (success, reason) => void finish(success, reason) });
        try { this.send([auth ? 'AUTH' : 'EVENT', event]); this.stats.publishes++; }
        catch (e) { void finish(false, e.message); }
      });
    }, { allowAuth: auth });
  }
  armIdle() { clearTimeout(this.idleTimer); if (!this.queued && !this.pending.size) this.idleTimer = setTimeout(() => this.close(), LIMITS.idleTimeout); }
  close() { clearTimeout(this.idleTimer); this.socket?.close(); this.socket = null; }
  snapshot() { return { relay: this.url, connected: this.socket?.readyState === 1, queued: this.queued, ...this.stats, ...this.health, authRequired: !!this.challenge }; }
}
