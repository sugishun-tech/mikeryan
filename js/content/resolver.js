import { verifyEvent } from '../core/crypto.js?v=1.3.0';
import { LIMITS } from '../core/config.js?v=1.3.0';
import { isHex, stableJSON } from '../core/utils.js?v=1.3.0';
import { CONTENT_LIMITS, matchesReference, referenceKey, repostReference } from './references.js?v=1.3.0';

/** Bounded, view-local single flight. No event/media storage or relay discovery. */
export class ContentResolver {
  constructor(repo) { this.repo=repo; this.memo=new Map(); this.scope=null; }
  reset() { this.memo.clear(); this.scope=null; }
  currentScope() { return `${this.repo.generation}:${stableJSON(this.repo.readRelays())}`; }
  once(key, task) {
    const scope=this.currentScope();
    if (scope!==this.scope) { this.memo.clear(); this.scope=scope; }
    const scoped=scope+':'+key;
    if (this.memo.has(scoped)) return this.memo.get(scoped);
    // Never evict a pending read and accidentally start it a second time.
    if (this.memo.size>=CONTENT_LIMITS.memo) return Promise.resolve(null);
    const result=Promise.resolve().then(task).then(value=>scope===this.currentScope()?value:null).catch(()=>null);
    this.memo.set(scoped,result); return result;
  }
  async resolve(reference) {
    if (!reference) return null;
    // Hint author/kind constraints apply to EACH caller, not just the first
    // concurrent nevent referring to this ID.
    const result=await this.once(referenceKey(reference), async()=>{
      if (reference.type==='profile') {
        await this.repo.profile(reference.pubkey);
        return this.repo.knownProfile(reference.pubkey) ? {type:'profile',pubkey:reference.pubkey} : null;
      }
      if (reference.type==='address') return this.repo.address(reference);
      if (reference.type==='event' && isHex(reference.id)) return this.repo.events.get(reference.id) ?? this.repo.event(reference.id);
      return null;
    });
    if (reference.type==='profile') return result;
    return matchesReference(result,reference) ? result : null;
  }
  repost(event) {
    return this.once('repost:'+event.id,async()=>{
      const scope=this.currentScope(), reference=repostReference(event);
      const expectedKind=event.tags.find(t=>t[0]==='k')?.[1];
      const matches=original=>original && original.id!==event.id &&
        (event.kind!==6 || original.kind===1) &&
        (event.kind!==16 || expectedKind===undefined || String(original.kind)===expectedKind) &&
        (!reference || matchesReference(original,reference));
      // A signed wrapper does NOT authenticate the claimed author's inner JSON.
      // Verify the inner hash AND signature before displaying it as that author.
      if (typeof event.content==='string' && event.content.length<=LIMITS.eventBytes) {
        try {
          const original=JSON.parse(event.content);
          if (matches(original) && await verifyEvent(original)) {
            if (scope!==this.currentScope()) return null;
            await this.repo.accept(original); return original;
          }
        } catch { /* Empty/invalid/mismatching JSON falls back to the tagged target. */ }
      }
      const original=await this.resolve(reference);
      return matches(original) ? original : null;
    });
  }
}
