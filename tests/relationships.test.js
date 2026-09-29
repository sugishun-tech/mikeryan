import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Social } from '../js/social/service.js';
import { Repository } from '../js/core/repository.js';
import { Storage } from '../js/core/storage.js';
import { RelayPool } from '../js/network/pool.js';
import { Emitter, compareEvents, latest, matchesFilter, sortEvents } from '../js/core/utils.js';
import { missingReplacementFilters } from '../js/network/profile-batch.js';
const key = n => n.toString(16).padStart(64, '0');
const owner = key(100), a = key(200), b = key(300);
const contact = (author, time, follows = [], id = key(time)) => ({kind:3, pubkey:author, id, created_at:time, tags:follows.map(p=>['p',p]), content:''});
const result = (events=[], complete=true) => ({events,complete,errors:complete?[]:[{relay:'wss://failed.example/',reason:'offline'}]});
function socialWith(read) {
  const repo = new Emitter(); repo.generation=1; repo.replacements=new Map();
  repo.accept=async e=>{const k=`${e.kind}:${e.pubkey}`,old=repo.replacements.get(k);if(!old||compareEvents(e,old)<0){repo.replacements.set(k,e);repo.emit('replace',{event:e});}};
  repo.replacementRead=async (kind,pubkey)=>read(pubkey);
  repo.replacement=async (kind,pubkey,options={})=>{const r=await read(pubkey);if(options.required&&!r.complete)throw Error('offline');return latest(r.events);};
  return new Social(repo,{pubkey:owner},{value:{}},{},{});
}
test('Discovered signed follow survives an empty author lookup',async()=>{
 const s=socialWith(()=>result());const positive=contact(a,200,[owner]);
 const back=await s.followingBack(owner,[a],{evidence:[positive]});
 assert.equal(back.has(a),true);
});
test('Newer discovered follow wins over an older direct lookup without the owner',async()=>{
 const s=socialWith(()=>result([contact(a,100)]));
 assert.equal((await s.followingBack(owner,[a],{evidence:[contact(a,200,[owner])]})).has(a),true);
});
test('A failed author lookup cannot erase a signed positive candidate',async()=>{
 const s=socialWith(()=>result([],false));
 const back=await s.followingBack(owner,[a],{evidence:[contact(a,200,[owner])]});
 assert.equal(back.has(a),true);assert.equal(back.complete,false);
});
test('A silent empty multi-author contact response must be isolated per author',()=>{
 const repairs=missingReplacementFilters([{kinds:[3],authors:[a,b],limit:2}],[]);
 assert.equal(repairs.length,2);
});

test('A newer explicit unfollow overrides discovered follow evidence',async()=>{
 const s=socialWith(()=>result([contact(a,300)]));
 const back=await s.followingBack(owner,[a],{evidence:[contact(a,200,[owner])]});
 assert.equal(back.has(a),false);assert.equal(back.unknown.has(a),false);assert.equal(back.complete,true);
});
test('Same-second replaceable-event tie selects the lexically lower ID',async()=>{
 const positive=contact(a,200,[owner],key(9)),negative=contact(a,200,[],key(5));
 const s=socialWith(()=>result([negative]));
 const back=await s.followingBack(owner,[a],{evidence:[positive]});
 assert.equal(back.has(a),false);assert.equal(back.contacts.get(a).id,negative.id);
});
test('Same-second discovered winner is not overridden by a losing direct event',async()=>{
 const positive=contact(a,200,[owner],key(5)),negative=contact(a,200,[],key(9));
 const back=await socialWith(()=>result([negative])).followingBack(owner,[a],{evidence:[positive]});
 assert.equal(back.has(a),true);assert.equal(back.complete,false);
});
test('Missing kind:3 is unknown, whereas signed empty kind:3 is negative',async()=>{
 const s=socialWith(k=>k===a?result():result([contact(b,200)]));
 const back=await s.followingBack(owner,[a,b]);
 assert.deepEqual([...back.unknown],[a]);assert.equal(back.has(b),false);assert.equal(back.incomplete.has(b),false);
});
test('One rejected user lookup cannot suppress another user\'s positive result',async()=>{
 const s=socialWith(k=>k===a?Promise.reject(Error('offline')):result([contact(b,200,[owner])]));
 const back=await s.followingBack(owner,[a,b]);
 assert.equal(back.has(b),true);assert.equal(back.unknown.has(a),true);
});
test('Previously observed newer unfollow is not resurrected by an older positive reply',async()=>{
 const s=socialWith(()=>result([contact(a,100,[owner])]));
 await s.repo.accept(contact(a,300));
 const back=await s.followingBack(owner,[a],{evidence:[contact(a,200,[owner])]});
 assert.equal(back.has(a),false);assert.equal(back.contacts.get(a).created_at,300);
});
test('Direct positive becomes repository evidence for badge updates',async()=>{
 const e=contact(a,200,[owner]);const s=socialWith(()=>result([e]));
 await s.followingBack(owner,[a]);assert.equal(s.repo.replacements.get(`3:${a}`).id,e.id);
});
test('Late replies after navigation cannot install relationship evidence in a new view',async()=>{
 let release;const s=socialWith(()=>new Promise(resolve=>{release=resolve;}));
 const job=s.followingBack(owner,[a]);s.repo.generation++;release(result([contact(a,200,[owner])]));
 await assert.rejects(job,/表示先/);assert.equal(s.repo.replacements.size,0);
});

import { FollowerDirectory } from '../js/social/followers.js';
const relayA='wss://a.example/', relayB='wss://b.example/';
function directoryWith({events=[],own=contact(owner,100),relays=[relayA],reverseMissing=[],fail={},direct,cap=Infinity}={}) {
 const s=socialWith(k=>direct?.(k) ?? result(k===owner?(own?[own]:[]):events.filter(e=>e.pubkey===k)));
 const repo=s.repo, requests=[];repo.readRelays=()=>relays;
 repo.query=async (filters,options)=>{
   requests.push({filters,options});const relay=options.relays[0];
   if(fail[relay]) return result(typeof fail[relay]==='object'?fail[relay].events??[]:[],false);
   const found=sortEvents(filters.flatMap(f=>sortEvents(events.filter(e=>!reverseMissing.includes(e.pubkey)&&matchesFilter(e,f))).slice(0,Math.min(f.limit,cap))));
   return result(found);
 };
 return {directory:new FollowerDirectory(repo,s,owner),repo,s,requests,fail};
}
test('Directory construction and read-state inspection perform no automatic network reads',()=>{
 const h=directoryWith();assert.equal(h.requests.length,0);assert.equal(h.directory.displayed.size,0);
});
test('Missing reverse index does not omit a directly verifiable mutual follow',async()=>{
 const e=contact(a,200,[owner]);const h=directoryWith({events:[e],own:contact(owner,100,[a]),reverseMissing:[a]});
 const page=await h.directory.next();assert.deepEqual(page.users,[a]);
 assert.equal(h.directory.ownerEvent.tags[0][1],a);
});
test('An offline relay cannot hide another relay\'s confirmed followers',async()=>{
 const h=directoryWith({events:[contact(a,200,[owner])],relays:[relayA,relayB],fail:{[relayB]:true}});
 const page=await h.directory.next();assert.deepEqual(page.users,[a]);assert.equal(page.exhausted,false);
 assert.match(page.warning,/取得できません/);
 assert.equal(h.directory.streams[1].pager.events.size,0);
});
test('A partial timed-out discovery response retains positive users without advancing that relay cursor',async()=>{
 const e=contact(a,200,[owner]);const h=directoryWith({events:[e],fail:{[relayA]:{events:[e]}}});
 const page=await h.directory.next();assert.deepEqual(page.users,[a]);
 assert.equal(h.directory.streams[0].pager.events.size,0);assert.equal(page.exhausted,false);
});
test('Recovered relay is retried at the original cursor and does not duplicate existing followers',async()=>{
 const h=directoryWith({events:[contact(a,200,[owner])],relays:[relayA,relayB],fail:{[relayB]:true}});
 await h.directory.next();delete h.fail[relayB];
 const page=await h.directory.next();assert.deepEqual(page.users,[]);assert.equal(h.directory.displayed.size,1);
 const reads=h.requests.filter(r=>r.options.relays[0]===relayB);assert.equal(reads[0].filters[0].until,reads[1].filters[0].until);
});
test('Unknown known-followee remains retryable and is recovered without advancing the discovery page',async()=>{
 let missing=true;const e=contact(a,200,[owner]);
 const h=directoryWith({own:contact(owner,100,[a]),direct:k=>k===a?result(missing?[]:[e]):undefined});
 const page=await h.directory.next();assert.deepEqual(page.users,[]);assert.equal(h.directory.pending.has(a),true);
 const n=h.requests.length;missing=false;const recovered=await h.directory.retry();
 assert.deepEqual(recovered.users,[a]);assert.equal(h.requests.length,n);assert.equal(h.directory.pending.size,0);
});
test('Signed newer unfollow removes a previously displayed uncertain follower on retry',async()=>{
 let unfollow=false;const positive=contact(a,200,[owner]);
 const h=directoryWith({events:[positive],direct:k=>k===a?result(unfollow?[contact(a,300)]:[],unfollow):undefined});
 assert.deepEqual((await h.directory.next()).users,[a]);unfollow=true;
 const page=await h.directory.retry();assert.deepEqual(page.removed,[a]);assert.equal(h.directory.displayed.size,0);
});
test('Merged discovery and direct-followee lanes append at most thirty unique people per operation',async()=>{
 const people=Array.from({length:65},(_,i)=>key(1000+i));
 const events=people.map((p,i)=>contact(p,1000-i,[owner]));
 const h=directoryWith({events,own:contact(owner,100,people),reverseMissing:people.slice(30)});
 let total=[];
 for(let i=0;(i<10&&!h.directory.exhausted)||i===0;i++){
   const page=await h.directory.next();assert.ok(page.users.length<=30);total.push(...page.users);
   if(i>10)assert.fail('directory did not exhaust');
 }
 assert.equal(total.length,65);assert.equal(new Set(total).size,65);assert.deepEqual(new Set(total),new Set(people));
});
test('Duplicate events from multiple relays are one identity, and buffers drain without additional traffic',async()=>{
 const people=Array.from({length:60},(_,i)=>key(1000+i));
 const events=people.map((p,i)=>contact(p,1000-i,[owner]));
 const h=directoryWith({events,relays:[relayA,relayB],own:contact(owner,100,people.slice(30))});
 const first=await h.directory.next();assert.equal(first.users.length,30);const n=h.requests.length;
 const second=await h.directory.next();assert.equal(second.users.length,30);assert.equal(h.requests.length,n);
 assert.equal(new Set([...first.users,...second.users]).size,60);
});
test('Concurrent follower button operations share one in-flight directory read',async()=>{
 const h=directoryWith({events:[contact(a,200,[owner])]});
 const one=h.directory.next(),two=h.directory.next();assert.equal(one,two);await one;assert.equal(h.requests.length,1);
});
test('Relay selection remains exactly the configured read-relay set',async()=>{
 const h=directoryWith({events:[contact(a,200,[owner])],relays:[relayA]});
 await h.directory.next();assert.deepEqual(h.requests.map(r=>r.options.relays),[[relayA]]);
});
test('List evidence is view-local and is not carried through Repository.beginView',async()=>{
 const repo=new Repository(new Storage(),{}, {value:{relays:[relayA],readRelayCount:1}});
 await repo.accept(contact(a,200,[owner]));repo.beginView();assert.equal(repo.replacements.has(`3:${a}`),false);
});

import { readPage } from '../js/network/page.js';
test('Coverage-probe failure preserves the initial verified page as partial evidence',async()=>{
 const e=contact(a,200,[owner]);let n=0;
 await assert.rejects(readPage({query:async()=>{if(n++)throw Error('probe failed');return [e];}}, {kinds:[3],'#p':[owner],limit:30}),error=>{
  assert.deepEqual(error.partial,[e]);return true;
 });
});

test('Real wire path isolates every author after a silently empty combined kind:3 response',async t=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url)));
 const e=fixture.events.find(e=>e.kind===3),requests=[];
 class Socket {
  constructor(){this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
  send(raw){const m=JSON.parse(raw);if(m[0]!=='REQ')return;requests.push(m);queueMicrotask(()=>{
    for(const f of m.slice(2))if(f.authors.length===1&&f.authors[0]===e.pubkey)this.onmessage?.({data:JSON.stringify(['EVENT',m[1],e])});
    this.onmessage?.({data:JSON.stringify(['EOSE',m[1]])});
  });}
  close(){this.readyState=3;this.onclose?.();}
 }
 const pool=new RelayPool(new Storage(),{socketFactory:()=>new Socket(),gap:0,timeout:1000});
 t.after(()=>pool.close());
 const r=await pool.query({relays:[relayA],gap:0,profileBatch:true,filters:[{kinds:[3],authors:[a,e.pubkey],limit:2}]});
 assert.equal(r.complete,true);assert.equal(r.events.some(x=>x.id===e.id),true);assert.equal(requests.length,3);
});

test('A newer signed unfollow received while buffered is not later painted as a follower',async()=>{
 const people=Array.from({length:60},(_,i)=>key(1000+i));
 const events=people.map((p,i)=>contact(p,1000-i,[owner]));
 const h=directoryWith({events,own:contact(owner,100,people.slice(30))});
 await h.directory.next();assert.equal(h.directory.queued.size,30);
 const keyToRemove=people[40];await h.repo.accept(contact(keyToRemove,2000));
 const page=await h.directory.next();assert.equal(page.users.includes(keyToRemove),false);assert.equal(page.users.length,29);
});
test('Repository updates remove an already displayed stale positive on the next manual operation',async()=>{
 const h=directoryWith({events:[contact(a,200,[owner])]});await h.directory.next();
 await h.repo.accept(contact(a,300));const page=await h.directory.next();
 assert.deepEqual(page.removed,[a]);assert.equal(h.directory.displayed.has(a),false);
});
test('Successful owner retry removes the obsolete owner-unknown warning',async()=>{
 let unavailable=true;
 const h=directoryWith({direct:k=>k===owner?result(unavailable?[]:[contact(owner,100)]):undefined});
 await h.directory.next();assert.match(h.directory.warning,/本人のフォローリストが未確認/);
 unavailable=false;await h.directory.readOwner();assert.doesNotMatch(h.directory.warning,/本人のフォローリストが未確認/);
});
