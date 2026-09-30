import { hexToBytes, bytesToHex } from './crypto.js?v=1.3.2';
import { isHex } from './utils.js?v=1.3.2';
const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
function polymod(values) { let c = 1; for (const v of values) { const top = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ v; for (let i=0;i<5;i++) if ((top >>> i)&1) c ^= GENERATORS[i]; } return c >>> 0; }
function expand(hrp) { const c = [...hrp].map(ch => ch.charCodeAt(0)); return [...c.map(x => x>>>5),0,...c.map(x => x&31)]; }
function convert(data, from, to, pad) {
  let acc=0, bits=0; const out=[], max=(1<<to)-1, mask=(1<<(from+to-1))-1;
  for (const value of data) { if (value < 0 || value >>> from) throw new Error('Invalid data'); acc=((acc<<from)|value)&mask; bits+=from; while(bits>=to){bits-=to;out.push((acc>>>bits)&max);} }
  if(pad) { if(bits) out.push((acc<<(to-bits))&max); }
  else if(bits>=from || ((acc<<(to-bits))&max)) throw new Error('Invalid padding');
  return out;
}
function encodeBytes(type, bytes) {
  const words=convert(bytes,8,5,true), c=polymod([...expand(type),...words,0,0,0,0,0,0])^1;
  return type+'1'+[...words,...Array.from({length:6},(_,i)=>(c>>>(5*(5-i)))&31)].map(w=>ALPHABET[w]).join('');
}
export function encodeKey(type, hex) {
  if (!['npub','note'].includes(type) || !isHex(hex)) throw new Error('公開鍵または投稿IDが不正です');
  return encodeBytes(type, hexToBytes(hex));
}
/** NIP-19 coordinates, also used for tag-only quote/repost permalinks. */
export function encodeAddress({kind, pubkey, identifier = ''}) {
  if (!isHex(pubkey) || !Number.isInteger(kind) || kind < 0 || kind > 65535) throw new Error('イベント座標が不正です');
  const d = new TextEncoder().encode(identifier);
  if (d.length > 255) throw new Error('イベント識別子が長すぎます');
  return encodeBytes('naddr', Uint8Array.from([0, d.length, ...d, 2, 32, ...hexToBytes(pubkey), 3, 4, 0, 0, kind >>> 8, kind & 255]));
}
export function decodeKey(value) {
  let text = String(value).trim().replace(/^nostr:/i,'');
  if (isHex(text.toLowerCase())) return { type: 'hex', data: text.toLowerCase() };
  if (text.length > 5000 || (text !== text.toLowerCase() && text !== text.toUpperCase())) throw new Error('Nostrアドレスが不正です');
  text=text.toLowerCase(); const p=text.lastIndexOf('1'), type=text.slice(0,p), words=[...text.slice(p+1)].map(c=>ALPHABET.indexOf(c));
  if(p<1 || words.length<6 || words.includes(-1) || polymod([...expand(type),...words])!==1) throw new Error('Nostrアドレスのチェックサムが不正です');
  const data = Uint8Array.from(convert(words.slice(0,-6),5,8,false));
  if(['npub','note'].includes(type) && data.length===32) return {type,data:bytesToHex(data)};
  if (['nprofile','nevent','naddr'].includes(type)) {
    const fields = new Map(), relays = [];
    for (let i = 0; i < data.length;) {
      if (i + 2 > data.length) throw new Error('Invalid TLV');
      const tag = data[i++], length = data[i++];
      if (i + length > data.length) throw new Error('Invalid TLV');
      const bytes = data.slice(i, i + length); i += length;
      if (tag === 1) relays.push(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      else if (tag===0 || (type!=='nprofile' && [2,3].includes(tag))) {
        if (fields.has(tag)) throw new Error('Duplicate TLV');
        fields.set(tag, bytes);
      } // Unrecognized TLV types are ignored (NIP-19).
    }
    const primary = fields.get(0), author = fields.get(2), kindBytes = fields.get(3);
    if (!primary || (type !== 'naddr' && primary.length !== 32) ||
        (author && author.length !== 32) || (kindBytes && kindBytes.length !== 4)) throw new Error('Invalid TLV value');
    const kind = kindBytes ? new DataView(kindBytes.buffer, kindBytes.byteOffset, 4).getUint32(0) : undefined;
    if (type === 'naddr') {
      if (!author || kind === undefined || kind > 65535 ||
          !([0,3].includes(kind) || (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000))) throw new Error('Invalid addressable kind');
      const identifier = new TextDecoder('utf-8', {fatal:true}).decode(primary);
      if (kind < 30000 && identifier) throw new Error('Invalid replaceable identifier');
      return {type, data:{kind, pubkey:bytesToHex(author), identifier}, relays};
    }
    return {type, data:bytesToHex(primary), relays,
      ...(author ? {author:bytesToHex(author)} : {}), ...(kind !== undefined ? {kind} : {})};
  }
  throw new Error('対応形式はhex、npub、nprofile、note、nevent、naddrです。秘密鍵は入力しないでください');
}
export function profileKey(value) { const d=decodeKey(value); if(!['hex','npub','nprofile'].includes(d.type))throw new Error('プロフィールの公開鍵を指定してください'); return d.data; }
