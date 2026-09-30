/** Pure content parsing and a single rich-slot policy. Never performs I/O. */
import { decodeKey, encodeKey, encodeAddress } from '../core/nip19.js?v=1.3.0';
import { isHex, safeURL } from '../core/utils.js?v=1.3.0';

export const CONTENT_LIMITS = Object.freeze({links:128, text:64000, reference:5006, memo:512, timeout:15000});
const TYPES = /^(?:npub|nprofile|note|nevent|naddr)1[0-9a-z]+$/i;
const IMAGES = /\.(?:jpe?g|png|webp|gif|avif|apng|bmp)$/i;
const IMAGE_MIMES = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/avif','image/apng','image/bmp']);
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

/** URLs retain their original spelling. Sentence punctuation is not part of a URL. */
export function* contentLinks(value) {
  const text = String(value ?? '');
  const regex = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uff65]+|nostr:(?:npub|nprofile|note|nevent|naddr)1[0-9a-z]+/gi;
  for (const match of text.matchAll(regex)) {
    if (match.index && /[\w]/.test(text[match.index-1])) continue;
    let raw = match[0];
    if (/^https?:/i.test(raw)) {
      raw = raw.replace(/[.,!;:]+$/, '');
      for (const [open, close] of [['(',')'],['[',']'],['{','}']]) {
        while (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) raw = raw.slice(0,-1);
      }
    }
    if (raw) yield {raw, index:match.index, end:match.index+raw.length};
  }
}
export function nostrReference(raw) {
  if (typeof raw !== 'string' || raw.length > CONTENT_LIMITS.reference || !/^nostr:/i.test(raw) || !TYPES.test(raw.slice(6))) return null;
  try {
    const decoded = decodeKey(raw), type = decoded.type;
    return {type: ['npub','nprofile'].includes(type) ? 'profile' : type === 'naddr' ? 'address' : 'event',
      ...(['npub','nprofile'].includes(type) ? {pubkey:decoded.data} : type === 'naddr' ? decoded.data : {id:decoded.data}),
      relays:decoded.relays ?? [], uri:raw, ...(decoded.author ? {author:decoded.author} : {}),
      ...(type === 'nevent' && decoded.kind !== undefined ? {kind:decoded.kind} : {})};
  } catch { return null; }
}
export function referenceURI(reference) {
  try {
    if (reference.type === 'profile') return 'nostr:'+encodeKey('npub',reference.pubkey);
    if (reference.type === 'event') return 'nostr:'+encodeKey('note',reference.id);
    if (reference.type === 'address') return 'nostr:'+encodeAddress(reference);
  } catch { /* Invalid or overlong coordinate: leave it as text. */ }
  return '';
}
export function referenceHref(reference) {
  if (reference.type === 'profile') return `#/profile/${reference.pubkey}/posts`;
  if (reference.type === 'event') return `#/thread/${reference.id}`;
  const uri = reference.uri || referenceURI(reference);
  return uri ? '#/address/'+encodeURIComponent(uri.replace(/^nostr:/i,'')) : '';
}
export function linkHref(raw) {
  if (/^nostr:/i.test(raw)) {
    const reference = nostrReference(raw);
    // Only public NIP-19 prefixes are allowed, including malformed references
    // as ordinary protocol links. Never link or send an nsec to another service.
    return reference ? referenceHref(reference) : TYPES.test(raw.slice(6)) && raw.length <= CONTENT_LIMITS.reference ? raw : '';
  }
  return safeURL(raw);
}
export function coordinateReference(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,5}):([0-9a-f]{64}):(.*)$/s.exec(value);
  if (!match) return null;
  const kind = Number(match[1]), identifier = match[3];
  if (!([0,3].includes(kind) || (kind>=10000&&kind<20000) || (kind>=30000&&kind<40000)) || (kind<30000&&identifier)) return null;
  return {type:'address',kind,pubkey:match[2],identifier};
}
export function tagReference(tag) {
  if (!Array.isArray(tag)) return null;
  const reference = isHex(tag[1]) ? {type:'event',id:tag[1]} : coordinateReference(tag[1]);
  return reference ? {...reference, relays:tag[2] ? [tag[2]] : [], uri:referenceURI(reference)} : null;
}
export function quoteReferences(event) {
  const result=[], seen=new Set();
  for (const tag of event.tags ?? []) {
    if (tag[0] !== 'q') continue;
    const reference=tagReference(tag);
    if (reference && !seen.has(referenceKey(reference))) {
      seen.add(referenceKey(reference)); result.push(reference);
      if (result.length >= CONTENT_LIMITS.links) break;
    }
  }
  return result;
}
export function repostReference(event) {
  if (event.kind === 16) {
    const address=(event.tags??[]).find(t=>t[0]==='a' && coordinateReference(t[1]));
    if (address) return tagReference(address);
  }
  const tag=(event.tags??[]).filter(t=>t[0]==='e' && isHex(t[1])).at(-1);
  return tag ? tagReference(tag) : null;
}
export const referenceKey = ref => ref.type === 'profile' ? 'p:'+ref.pubkey : ref.type === 'address' ? `a:${ref.kind}:${ref.pubkey}:${ref.identifier}` : 'e:'+ref.id;
export function matchesReference(event, reference) {
  if (!event || !reference) return false;
  if (reference.type === 'event') return event.id === reference.id && (!reference.author || event.pubkey === reference.author) &&
    (reference.kind === undefined || event.kind === reference.kind);
  if (reference.type === 'address') return event.kind === reference.kind && event.pubkey === reference.pubkey &&
    (reference.kind < 30000 || (event.tags.find(t=>t[0]==='d')?.[1] ?? '') === reference.identifier);
  return event.kind === 0 && event.pubkey === reference.pubkey;
}
export function imageMetadata(event) {
  const records = new Map();
  for (const tag of event.tags ?? []) {
    if (tag[0] !== 'imeta') continue;
    const fields={};
    for (const entry of tag.slice(1)) {
      const space=entry.indexOf(' '); if (space<1) continue;
      const key=entry.slice(0,space), value=entry.slice(space+1);
      if (['url','m','alt','dim'].includes(key) && !(key in fields)) fields[key]=value;
    }
    const url=safeURL(fields.url,{image:true}); if (!url || records.has(url)) continue;
    const dim=/^(\d{1,6})x(\d{1,6})$/.exec(fields.dim ?? '');
    records.set(url,{mime:fields.m?.toLowerCase(),alt:(fields.alt??'').slice(0,1000),
      ...(dim && +dim[1]>0 && +dim[2]>0 ? {width:+dim[1],height:+dim[2]} : {})});
    if (records.size>=CONTENT_LIMITS.links) break;
  }
  return records;
}
export function webReference(raw, metadata=new Map(), {images=true}={}) {
  const href=safeURL(raw); if (!href) return null;
  const url=new URL(href);
  // Nonstandard ports are allowed for HTTPS image hosts, never providers.
  const host=url.hostname.toLowerCase();
  if (!url.port && ['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com','mobile.x.com'].includes(host)) {
    const match=/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status\/([1-9]\d{0,19})\/?$/.exec(url.pathname);
    if (match) return {type:'x',id:match[1],href:`https://x.com/i/web/status/${match[1]}`,raw};
  }
  let id;
  if (!url.port && ['youtube.com','www.youtube.com','m.youtube.com'].includes(host)) {
    if (url.pathname==='/watch') id=url.searchParams.get('v');
    else id=/^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  } else if (!url.port && ['youtu.be','www.youtu.be'].includes(host)) id=/^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (id && VIDEO_ID.test(id)) return {type:'youtube',id,href:`https://www.youtube.com/watch?v=${id}`,raw};
  const meta=metadata.get(href) ?? {};
  if (images && url.protocol==='https:' && (IMAGES.test(url.pathname) || IMAGE_MIMES.has(meta.mime))) {
    return {type:'image',href,raw,...meta};
  }
  return null;
}
/** One slot across ALL content types. Body order wins; q-only quotes come last.
 * Only the first syntactic NIP-21 occurrence is eligible, even if invalid.
 * A failed winner is not replaced by a later candidate (no cascading requests).
 */
export function contentPlan(event, {depth=0, images=true}={}) {
  const quotes=quoteReferences(event);
  if (depth>=1) return {embed:null,quotes};
  if ([6,16].includes(event.kind)) return {embed:{type:'repost',event,reference:repostReference(event)},quotes:[]};
  const metadata=imageMetadata(event); let firstNostr=true;
  for (const token of contentLinks(event.content)) {
    if (/^nostr:/i.test(token.raw)) {
      if (!firstNostr) continue;
      firstNostr=false;
      const reference=nostrReference(token.raw);
      if (reference) return {embed:{type:'nostr',reference},quotes};
    } else {
      const embed=webReference(token.raw,metadata,{images});
      if (embed) return {embed,quotes};
    }
  }
  return {embed:quotes.length ? {type:'nostr',reference:quotes[0]} : null,quotes};
}
