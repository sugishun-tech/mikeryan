import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventPager } from '../js/feed/pagination.js';
import { readPage } from '../js/network/page.js';
import { RelayPool } from '../js/network/pool.js';
import { RelayConnection } from '../js/network/relay.js';
import { Repository } from '../js/core/repository.js';
import { Storage } from '../js/core/storage.js';
import { LIMITS, DEFAULTS } from '../js/core/config.js';
import { compactLatestFilters, missingReplacementFilters } from '../js/network/profile-batch.js';
import { verifyEvent, validEventShape } from '../js/core/crypto.js';
import { matchesFilter, sortEvents, sleep } from '../js/core/utils.js';

const key = n => n.toString(16).padStart(64, '0');
const event = (n, time, author = key(1000), kind = 1) => ({id:key(n), created_at:time, pubkey:author, kind, content:'test', tags:[]});
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/events.json', import.meta.url)));
const largeLists = JSON.parse(fs.readFileSync(new URL('./fixtures/large-lists.json', import.meta.url)));
function connection(events, cap = Infinity) {
  const calls = [];
  return {calls, query:async filters => {
    calls.push(filters);
    return sortEvents(filters.flatMap(f => sortEvents(events.filter(e => matchesFilter(e,f))).slice(0,Math.min(f.limit,cap))));
  }};
}
function paged(sources, filters = [{kinds:[1]}]) {
  const calls = [];
  const pager = new EventPager(async fs => {
    calls.push(fs);
    const results = [];
    for (const [relay,c] of sources.entries()) for (const f of fs) {
      const result = await readPage(c, f); results.push({relay,...result});
    }
    return {events:sortEvents(results.flatMap(r => r.events)), sources:results.map(r => ({relay:r.relay,...r.source})), complete:true, errors:[]};
  }, filters);
  return {pager,calls};
}

test('Nonempty partial latest results never replace the screen or become a cursor', async () => {
  const old=event(1,20), partial=event(2,100);
  const pager=new EventPager(async()=>({events:[partial],complete:false,errors:[{reason:'offline'}]}),[{kinds:[1]}]);
  pager.events.set(old.id,old);
  assert.deepEqual(await pager.load('latest',null,200),[]);
  assert.deepEqual([...pager.events.values()],[old]);
  assert.match(pager.warning,/進めていません/);
});
test('First read with one failed relay does not install a partial timeline', async () => {
  const pager=new EventPager(async()=>({events:[event(1,100)],complete:false,errors:[]}),[{kinds:[1]}]);
  assert.deepEqual(await pager.older(),[]); assert.equal(pager.events.size,0);assert.equal(pager.exhausted,false);
});
test('Snapshot rollback retains both timeline and directional search state', async () => {
  const h=paged([connection([event(1,100),event(2,99)])]);
  h.pager.events.set(key(10),event(10,1));h.pager.search={anchor:key(10),low:1,high:3,span:2,limit:30};
  const snapshot=h.pager.snapshot();await h.pager.load('latest',null,100);h.pager.restore(snapshot);
  assert.deepEqual([...h.pager.events.keys()],[key(10)]);assert.equal(h.pager.search.high,3);
});
test('A short page with older data is not marked exhausted and repairs stay bounded', async () => {
  const c=connection(Array.from({length:50},(_,i)=>event(i+1,100-i)),3);
  const r=await readPage(c,{kinds:[1],until:100,limit:30});
  assert.equal(r.source.exhausted,false);assert.equal(r.events.length,5);
  assert.equal(c.calls.length,1+LIMITS.pageRepairs);
  assert.deepEqual(r.events.map(e=>e.created_at),[100,99,98,97,96]);
});
test('Ordinary capped streams merge without jumping over a slower stream', async () => {
  const a=Array.from({length:60},(_,i)=>event(i+1,200-i*2));
  const b=Array.from({length:60},(_,i)=>event(100+i,199-i*2));
  const {pager}=paged([connection(a,3),connection(b)]);
  await pager.load('latest',null,200);
  for(let i=0;i<80&&!pager.exhausted;i++)await pager.older();
  assert.deepEqual(sortEvents([...pager.events.values()]).map(e=>e.id),sortEvents([...a,...b]).map(e=>e.id));
  assert.equal(pager.exhausted,true);
});
test('A capped same-second response cannot jump to an older peer relay', async () => {
  const same=Array.from({length:80},(_,i)=>event(i+1,100));
  const {pager}=paged([connection([...same,event(500,99)],30),connection([event(700,90)])]);
  const first=await pager.load('latest',null,100);assert.equal(first.length,30);
  const before=[...pager.events.keys()];assert.deepEqual(await pager.older(),[]);
  assert.deepEqual([...pager.events.keys()],before);assert.equal(pager.exhausted,false);
  assert.match(pager.warning,/件数制限/);assert.ok(!pager.events.has(key(700)));
});
test('Unequal relay histories retain a safe common coverage boundary', async () => {
  const newer=Array.from({length:80},(_,i)=>event(i+1,300-i));
  const older=Array.from({length:80},(_,i)=>event(200+i,200-i));
  const {pager}=paged([connection(newer,4),connection(older)]);
  const first=await pager.load('latest',null,300);
  assert.deepEqual(first.map(e=>e.created_at),[300,299,298,297,296,295,294]);
  assert.ok(!first.some(e=>e.created_at<294));
});
test('Short exhausted histories still allow other relay streams to continue', async () => {
  const a=[event(1,100)];const b=Array.from({length:70},(_,i)=>event(i+2,99-i));
  const {pager}=paged([connection(a),connection(b)]);
  await pager.load('latest',null,100);
  for(let i=0;i<10&&!pager.exhausted;i++)await pager.older();
  assert.equal(pager.events.size,71);assert.equal(pager.exhausted,true);
});
test('Nearest-newer pages with a silently capped relay do not skip nearer seconds', async () => {
  const data=Array.from({length:250},(_,i)=>event(i+1,500-i));
  const {pager}=paged([connection(data,3)]);const anchor=data[200];let page=[];
  for(let i=0;i<12&&!page.length;i++)page=await pager.load('newer',anchor,500);
  assert.ok(page.length>0);assert.equal(page.at(-1).created_at,anchor.created_at+1);
  assert.deepEqual(page.map(e=>e.created_at),Array.from({length:page.length},(_,i)=>anchor.created_at+page.length-i));
});
test('Saturation is evaluated per filter rather than from the merged union', async () => {
  const authors=[key(1),key(2)],data=authors.flatMap((author,j)=>Array.from({length:20},(_,i)=>event(j*100+i+1,100,author)));
  let calls=0;const pager=new EventPager(async fs=>{calls++;return {events:data,complete:true,errors:[]};},authors.map(author=>({kinds:[1],authors:[author]})));
  const page=await pager.load('newer',event(900,100),100);
  assert.equal(page.length,30);assert.equal(calls,1);
});
test('Older search resumes at its increased limit instead of repeating the same six probes', async () => {
  const data=Array.from({length:1500},(_,i)=>event(i+1,100));const c=connection(data);const {pager}=paged([c]);
  const anchor=data[1200];pager.events.set(anchor.id,anchor);
  assert.deepEqual(await pager.load('older',anchor,100),[]);
  assert.equal(pager.downSearch.limit,1600);
  const page=await pager.load('older',anchor,100);assert.equal(page[0].id,data[1201].id);assert.equal(page.length,30);
});
test('Latest list batching preserves kinds and never changes ordinary timeline filters', () => {
  const ordinary={kinds:[1],authors:[key(1),key(2)],limit:1};
  const filters=compactLatestFilters([ordinary,{kinds:[3],authors:[key(1)],limit:1},{kinds:[3],authors:[key(2)],limit:1},{kinds:[10000],authors:[key(1)],limit:1}]);
  assert.ok(filters.some(f=>JSON.stringify(f)===JSON.stringify({authors:ordinary.authors,kinds:ordinary.kinds,limit:1})));
  assert.deepEqual(filters.find(f=>f.kinds[0]===3),{authors:[key(1),key(2)],kinds:[3],limit:2});
  assert.equal(filters.find(f=>f.kinds[0]===10000).limit,1);
});
test('Missing latest contacts are repaired per author, never inferred as unfollowed', () => {
  const filters=[{kinds:[3],authors:[key(1),key(2),key(3)],limit:3}];
  assert.deepEqual(missingReplacementFilters(filters,[event(1,100,key(1),3)]),[
    {authors:[key(2)],kinds:[3],limit:1},{authors:[key(3)],kinds:[3],limit:1}
  ]);
});
test('All-empty multi-filter replies still isolate required public lists', () => {
  const filters=[{kinds:[3],authors:[key(1)],limit:1},{kinds:[10000],authors:[key(1)],limit:1}];
  assert.equal(missingReplacementFilters(filters,[]).length,2);
  assert.equal(missingReplacementFilters([filters[0]],[]).length,0);
});

function wire(t, {events=fixture.events, firstFilterOnly=false, throwVerifier=false, gap=0}={}) {
  const requests=[],times=[];
  class Socket {
    constructor(){this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
    emit(message){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(message)});}
    send(text){const m=JSON.parse(text);if(m[0]!=='REQ')return;requests.push(m);times.push(Date.now());
      queueMicrotask(()=>{const fs=firstFilterOnly?m.slice(2,3):m.slice(2);
        for(const e of sortEvents(fs.flatMap(f=>sortEvents(events.filter(e=>matchesFilter(e,f))).slice(0,f.limit))))this.emit(['EVENT',m[1],e]);
        this.emit(['EOSE',m[1]]);
      });}
    close(){this.readyState=3;this.onclose?.();}
  }
  const options={socketFactory:()=>new Socket(),timeout:200,gap,...(throwVerifier?{verify:async()=>{throw Error('crypto offline');}}:{})};
  const pool=new RelayPool(new Storage(),options);t.after(async()=>{await sleep(1);pool.close();});
  return {pool,requests,times,options};
}
test('Wire path repairs a mute list ignored by a first-filter-only relay', async t => {
  const h=wire(t,{firstFilterOnly:true});const author=fixture.keys.alice;
  const r=await h.pool.query({relays:['wss://test.example/'],gap:0,profileBatch:true,filters:[{kinds:[3],authors:[author],limit:1},{kinds:[10000],authors:[author],limit:1}]});
  assert.equal(r.complete,true);assert.ok(r.events.some(e=>e.kind===3));assert.ok(r.events.some(e=>e.kind===10000));
  assert.equal(h.requests.length,2);
});
test('Wire page queries isolate different author groups so ignored filters cannot lose users', async t => {
  const h=wire(t,{firstFilterOnly:true});const authors=[fixture.keys.alice,fixture.keys.bob];
  const r=await h.pool.query({relays:['wss://test.example/'],gap:0,page:true,filters:authors.map(author=>({kinds:[1],authors:[author],limit:30}))});
  assert.equal(r.complete,true);assert.equal(r.sources.length,2);
  assert.ok(authors.every(author=>r.events.some(e=>e.pubkey===author)));
  assert.ok(h.requests.every(req=>req.length===3));
});
test('4000-person signed follow and mute lists verify without relaxing note/profile bounds', async () => {
  for(const e of largeLists){assert.ok(JSON.stringify(e).length>LIMITS.eventBytes);assert.equal(validEventShape(e),true);assert.equal(await verifyEvent(e),true);}
  const note={...largeLists[0],kind:1,content:'x'.repeat(LIMITS.eventBytes+1)};assert.equal(validEventShape(note),false);
});
test('Large follow/mute lists survive the full transport/repository path with all keys intact', async t => {
  const h=wire(t,{events:largeLists});const repo=new Repository(new Storage(),h.pool,{value:{...DEFAULTS,relays:['wss://test.example/'],readRelayCount:1,requestGapMs:0}});
  const results=await Promise.all([repo.replacement(3,largeLists[0].pubkey,{required:true}),repo.replacement(10000,largeLists[0].pubkey,{required:true})]);
  assert.deepEqual(results.map(e=>e.tags.length),[4000,4000]);
});
test('An oversize public list is an incomplete read, not a successful empty list', async t => {
  const oversized={...largeLists[0],content:'x'.repeat(LIMITS.listEventBytes)};const h=wire(t,{events:[oversized]});
  const r=await h.pool.query({relays:['wss://test.example/'],gap:0,filters:[{kinds:[3],authors:[oversized.pubkey],limit:1}]});
  assert.equal(r.complete,false);assert.match(r.errors[0].reason,/空の一覧としては扱いません/);
});
test('A crypto-provider exception settles the request and closes it instead of hanging', async t => {
  const h=wire(t,{throwVerifier:true});
  const r=await h.pool.query({relays:['wss://test.example/'],gap:0,filters:[{kinds:[1],limit:30}]});
  assert.equal(r.complete,false);assert.match(r.errors[0].reason,/署名検証/);assert.equal(h.pool.connection('wss://test.example/').pending.size,0);
});
test('Connection queue still spaces requests after successful EOSE', async t => {
  const h=wire(t,{gap:25});const c=new RelayConnection('wss://queue.example/',new Storage(),h.options);t.after(()=>c.close());
  await Promise.all([c.query([{kinds:[1],limit:30}]),c.query([{kinds:[1],limit:30}])]);
  assert.equal(h.times.length,2);assert.ok(h.times[1]-h.times[0]>=23);
});
