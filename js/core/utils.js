export const HEX = /^[0-9a-f]{64}$/;
export const isHex = value => typeof value === 'string' && HEX.test(value);
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const unique = values => [...new Set(values)];
export const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
export const lines = value => String(value ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export const shortKey = key => `${String(key).slice(0, 8)}…${String(key).slice(-4)}`;
export const compareEvents = (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id);
export const sortEvents = events => [...new Map(events.filter(Boolean).map(e => [e.id, e])).values()].sort(compareEvents);
export function latest(events) { return sortEvents(events)[0] ?? null; }
export function parseJSON(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJSON(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function normalizeRelay(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!['wss:', 'ws:'].includes(u.protocol) || u.username || u.password || u.hash) return null;
    // HTTPS Pages cannot use insecure sockets. Local ws is allowed for development only.
    if (u.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.href;
  } catch { return null; }
}
export function safeURL(raw, { image = false } = {}) {
  try {
    const u = new URL(String(raw));
    if (!['https:', ...(image ? [] : ['http:'])].includes(u.protocol) || u.username || u.password) return '';
    return u.href;
  } catch { return ''; }
}
export function matchesFilter(event, filter) {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  return Object.entries(filter).every(([key, values]) => !key.startsWith('#') || event.tags.some(t => t[0] === key.slice(1) && values.includes(t[1])));
}
export function canonicalFilters(filters) {
  return unique(filters.map(f => stableJSON(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) ? unique(v).sort() : v]))))).sort().map(s => JSON.parse(s));
}
export function parentId(event) {
  const tags = (event?.tags ?? []).filter(t => t[0] === 'e' && isHex(t[1]));
  return (tags.find(t => t[3] === 'reply') ?? tags.find(t => t[3] === 'root') ?? tags.filter(t => !t[3]).at(-1))?.[1] ?? null;
}
export function replyTags(parent, self) {
  const root = parent.tags.find(t => t[0] === 'e' && t[3] === 'root' && isHex(t[1]));
  const legacy = parent.tags.find(t => t[0] === 'e' && !t[3] && isHex(t[1]));
  const ancestor = root ?? legacy;
  const tags = ancestor ? [['e', ancestor[1], ancestor[2] || '', 'root', ancestor[4] || ''], ['e', parent.id, '', 'reply', parent.pubkey]] : [['e', parent.id, '', 'root', parent.pubkey]];
  for (const key of unique([parent.pubkey, ...parent.tags.filter(t => t[0] === 'p').map(t => t[1])]).filter(isHex)) {
    if (key !== self) tags.push(['p', key]);
  }
  return tags;
}
export function cleanClient(event) {
  const name = event.tags.find(t => t[0] === 'client')?.[1] ?? '';
  return [...name.slice(0, 640).normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim()].slice(0, 40).join('');
}
export function errorText(error) { return error instanceof Error ? error.message : String(error); }
export class Emitter {
  constructor() { this.listeners = new Map(); }
  on(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); return () => this.listeners.get(type)?.delete(callback); }
  emit(type, data) { for (const cb of this.listeners.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } } }
}
