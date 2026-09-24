import { normalizeRelay, parseJSON, unique } from '../core/utils.js?v=1.2.0';

/** NIP-65 entries are public account data, never application connection settings. */
export function relayEntries(modern, contacts = null) {
  if (modern) return modern.tags.filter(t=>t[0]==='r' && typeof t[1]==='string')
    .map(t=>({url:t[1],mode:t[2]||'read/write'}));
  const legacy=parseJSON(contacts?.content,{});
  if(Array.isArray(legacy))return legacy.filter(url=>typeof url==='string').map(url=>({url,mode:'read/write'}));
  if(!legacy || typeof legacy!=='object')return [];
  return Object.entries(legacy).flatMap(([url,flags])=>{
    const read=flags?.read!==false, write=flags?.write!==false;
    return read||write?[{url,mode:read&&write?'read/write':read?'read':'write'}]:[];
  });
}
export function relayListTags(modern, contacts) {
  if(modern)return modern.tags.map(t=>[...t]);
  const seen=new Set();
  return relayEntries(null,contacts).flatMap(({url,mode})=>{
    const normalized=normalizeRelay(url);if(!normalized||seen.has(normalized))return [];
    seen.add(normalized);return [['r',normalized,...(mode==='read/write'?[]:[mode])]];
  });
}
export function changeRelayTags(tags,{action,url,mode='read/write'}) {
  const normalized=normalizeRelay(url);
  if(!normalized)throw new Error('有効なwss://リレーURLを入力してください');
  if(!['add','remove'].includes(action))throw new Error('リレー操作が不正です');
  if(!['read/write','read','write'].includes(mode))throw new Error('読み書きの指定が不正です');
  const match=tag=>tag[0]==='r' && normalizeRelay(tag[1])===normalized;
  const exists=tags.some(match);
  if(action==='remove')return {tags:tags.filter(t=>!match(t)),changed:exists};
  if(exists)return {tags,changed:false};
  if(tags.filter(t=>t[0]==='r').length>=100)throw new Error('公開リレーリストは100件以内にしてください');
  return {tags:[...tags,['r',normalized,...(mode==='read/write'?[]:[mode])]],changed:true};
}
