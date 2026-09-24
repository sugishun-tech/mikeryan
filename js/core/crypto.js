/* Public-data-only BIP-340 verification. Never use these non-constant-time
 * point operations with private keys. All signing is delegated to NIP-07.
 * Equations: BIP-340; Jacobian coordinates avoid an inverse per addition. */
import { isHex } from './utils.js?v=1.1.0';
import { LIMITS } from './config.js?v=1.1.0';
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n, 1n];
const INF = [0n, 1n, 0n];
const mod = x => ((x % P) + P) % P;
function pow(x, n) { let r = 1n; x = mod(x); while (n) { if (n & 1n) r = r * x % P; x = x * x % P; n >>= 1n; } return r; }
function double([x, y, z]) {
  if (!z || !y) return INF;
  const a = x * x % P, b = y * y % P, c = b * b % P;
  const d = mod(2n * (mod((x + b) * (x + b)) - a - c)), e = 3n * a % P;
  const nx = mod(e * e - 2n * d);
  return [nx, mod(e * (d - nx) - 8n * c), 2n * y * z % P];
}
function add(a, b) {
  if (!a[2]) return b; if (!b[2]) return a;
  const [x1,y1,z1] = a, [x2,y2,z2] = b;
  const z1s = z1*z1%P, z2s = z2*z2%P;
  const u1 = x1*z2s%P, u2 = x2*z1s%P, s1 = y1*z2*z2s%P, s2 = y2*z1*z1s%P;
  if (u1 === u2) return s1 === s2 ? double(a) : INF;
  const h = mod(u2-u1), r = mod(s2-s1), hh = h*h%P, hhh = hh*h%P, v = u1*hh%P;
  const nx = mod(r*r-hhh-2n*v);
  return [nx, mod(r*(v-nx)-s1*hhh), h*z1*z2%P];
}
function multiply(point, scalar) { let r = INF; while (scalar) { if (scalar&1n) r = add(r, point); point = double(point); scalar >>= 1n; } return r; }
export const bytesToHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) throw new Error('Invalid hexadecimal data');
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], x => parseInt(x, 16));
}
const encode = text => new TextEncoder().encode(text);
const sha256 = async data => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
let challengeTag;
export async function verifySchnorr(message, pubkeyHex, signatureHex) {
  try {
    if (!/^[a-f0-9]{64}$/i.test(pubkeyHex) || !/^[a-f0-9]{128}$/i.test(signatureHex)) return false;
    const px = BigInt('0x' + pubkeyHex), r = BigInt('0x' + signatureHex.slice(0,64)), s = BigInt('0x' + signatureHex.slice(64));
    if (px >= P || r >= P || s >= N) return false;
    const y2 = (px*px%P*px+7n)%P; let py = pow(y2, (P+1n)/4n);
    if (py*py%P !== y2) return false; if (py&1n) py = P-py;
    challengeTag ??= sha256(encode('BIP0340/challenge'));
    const tag = await challengeTag;
    const input = new Uint8Array(128 + message.length);
    input.set(tag); input.set(tag,32); input.set(hexToBytes(signatureHex.slice(0,64)),64); input.set(hexToBytes(pubkeyHex),96); input.set(message,128);
    const e = BigInt('0x'+bytesToHex(await sha256(input))) % N;
    const result = add(multiply(G,s), multiply([px,py,1n], N-e));
    if (!result[2]) return false;
    const zi = pow(result[2],P-2n), x = result[0]*zi%P*zi%P, y = result[1]*zi%P*zi%P*zi%P;
    return x === r && (y&1n) === 0n;
  } catch { return false; }
}
export function validEventShape(e) {
  return !!e && isHex(e.id) && isHex(e.pubkey) && typeof e.sig === 'string' && /^[0-9a-f]{128}$/.test(e.sig)
    && Number.isSafeInteger(e.created_at) && e.created_at >= 0 && Number.isInteger(e.kind) && e.kind >= 0 && e.kind <= 65535
    && typeof e.content === 'string' && e.content.length <= LIMITS.eventBytes
    && Array.isArray(e.tags) && e.tags.length <= LIMITS.tags && e.tags.every(t => Array.isArray(t) && t.length > 0 && t.every(v => typeof v === 'string'));
}
export async function eventHash(event) { return bytesToHex(await sha256(encode(JSON.stringify([0,event.pubkey,event.created_at,event.kind,event.tags,event.content])))); }
export async function verifyEvent(event) {
  if (!validEventShape(event)) return false;
  if (encode(JSON.stringify(event)).length > LIMITS.eventBytes) return false;
  const hash = await eventHash(event);
  return hash === event.id && await verifySchnorr(hexToBytes(hash), event.pubkey, event.sig);
}
