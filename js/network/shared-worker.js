import { Storage } from '../core/storage.js';
import { RelayPool } from './pool.js';
const storage = new Storage();
const pool = new RelayPool(storage);
void storage.prune();
const allowed = new Set(['query', 'publish', 'stats', 'authInfo', 'authenticate']);
self.onconnect = event => {
  const port = event.ports[0];
  port.onmessage = async ({ data }) => {
    const { id, method, payload } = data ?? {};
    if (method === 'hello') { port.postMessage({ id, result: { ready: true } }); return; }
    if (!allowed.has(method)) return;
    try { port.postMessage({ id, result: await pool[method](payload) }); }
    catch (e) { try { port.postMessage({ id, error: e.message }); } catch {} }
  };
  port.start();
};
