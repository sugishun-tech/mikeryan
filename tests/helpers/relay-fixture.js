/** In-process wire-protocol relay for tests/benchmarks, not a public relay.
 * Production signature verification, pool and subscription code stay enabled.
 */
import { RelayPool } from '../../js/network/pool.js';
import { Storage } from '../../js/core/storage.js';
import { matchesFilter, sortEvents } from '../../js/core/utils.js';

export function fakeRelay({events = [], perRelay = {}, caps = {}, fail = {}, delay = 0, Pool = RelayPool} = {}) {
  const messages = [], responses = [], sockets = [];
  const storage = new Storage();
  class Socket {
    constructor(url) {
      this.url = url; this.readyState = 0; sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
    }
    emit(message) {
      if (this.readyState !== 1) return;
      responses.push({url: this.url, message});
      this.onmessage?.({data: JSON.stringify(message)});
    }
    send(text) {
      const message = JSON.parse(text); messages.push({url: this.url, message});
      if (message[0] !== 'REQ') return;
      setTimeout(() => {
        const reason = typeof fail[this.url] === 'function' ? fail[this.url](message) : fail[this.url];
        if (reason) { this.emit(['CLOSED', message[1], reason]); return; }
        const selected = new Map(), source = perRelay[this.url] ?? events;
        for (const f of message.slice(2)) {
          const matched = sortEvents(source.filter(event => matchesFilter(event, f)));
          const cap = typeof caps[this.url] === 'function' ? caps[this.url](f) : caps[this.url];
          for (const event of matched.slice(0, Math.min(f.limit, cap ?? Infinity))) selected.set(event.id, event);
        }
        for (const event of sortEvents([...selected.values()])) this.emit(['EVENT', message[1], event]);
        this.emit(['EOSE', message[1]]);
      }, delay);
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const pool = new Pool(storage, {socketFactory: url => new Socket(url), gap: 0, timeout: 3000});
  return {pool, storage, messages, responses, sockets, events, perRelay, fail, caps,
    requests: () => messages.filter(row => row.message[0] === 'REQ'),
    close: async () => { await new Promise(resolve => setTimeout(resolve, 2)); pool.close(); }};
}
