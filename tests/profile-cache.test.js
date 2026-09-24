import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ProfileCache} from '../js/profiles/cache.js';
import {Repository} from '../js/core/repository.js';
import {DEFAULTS} from '../js/core/config.js';
import {fakeRelay} from './helpers/relay-fixture.js';
import {idbFixture} from './helpers/idb-fixture.js';
const d=JSON.parse(fs.readFileSync(new URL('./fixtures/traffic.json',import.meta.url)));
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url)));
const e=d.profiles[0],relay='wss://cache.example/';
const settings={value:{...DEFAULTS,relays:[relay],readRelayCount:1,requestGapMs:0}};
function disk(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v))};}
function setup(t){const h=fakeRelay({events:[...d.profiles,...d.pages.flat(),...d.reactions]}),local=disk();
 const cache=new ProfileCache({indexedDB:null,localStorage:local});
 const repo=new Repository(h.storage,h.pool,settings,{profileCache:cache});t.after(()=>h.close());return {...h,repo,cache,local};}

test('Persistent profile store rejects posts, lists, reactions and malformed kind:0',async()=>{
 const cache=new ProfileCache({indexedDB:null,localStorage:disk()});
 for(const kind of [1,3,7,10000,10002])await assert.rejects(cache.put({...e,kind}),/kind:0/);
 for(const content of ['null','[]','bad json'])await assert.rejects(cache.put({...e,content}),/kind:0/);
});
test('Saved public profile is reverified from local storage and survives independent cache instances',async()=>{
 const local=disk();await new ProfileCache({indexedDB:null,localStorage:local}).put(e);
 const second=new ProfileCache({indexedDB:null,localStorage:local});assert.deepEqual((await second.get(e.pubkey)).event,e);assert.equal(second.stats.hits,1);
});
test('Persistent profile records have no TTL or automatic expiration',async()=>{
 const local=disk(),cache=new ProfileCache({indexedDB:null,localStorage:local});await cache.put(e);
 const [key]=local.map.keys(),value=JSON.parse(local.getItem(key));value.savedAt=1;local.setItem(key,JSON.stringify(value));
 assert.ok(await new ProfileCache({indexedDB:null,localStorage:local}).get(e.pubkey));assert.equal('expires' in value,false);
});
test('Saved signature corruption is rejected and repaired by the next valid explicit fetch',async()=>{
 const local=disk(),cache=new ProfileCache({indexedDB:null,localStorage:local});await cache.put(e);
 const [key]=local.map.keys(),value=JSON.parse(local.getItem(key));value.event.content='{"name":"tampered"}';local.setItem(key,JSON.stringify(value));
 const reload=new ProfileCache({indexedDB:null,localStorage:local});assert.equal(await reload.get(e.pubkey),null);
 await reload.put(e);assert.equal((await reload.get(e.pubkey)).event.content,e.content);
});
test('Incidental newer events do not refresh a saved profile; explicit refresh does',async t=>{
 const h=setup(t);await h.repo.profile(e.pubkey);h.events.push(d.updated);
 await h.repo.accept(d.updated);assert.notEqual(h.repo.peekProfile(e.pubkey).name,'updated-on-second-relay');
 await h.repo.profile(e.pubkey);assert.equal(h.requests().length,1);
 await h.repo.profile(e.pubkey,{fresh:true});assert.equal(h.repo.peekProfile(e.pubkey).name,'updated-on-second-relay');
});
test('Failed explicit refresh retains persisted metadata and reports the failure',async t=>{
 const h=setup(t);await h.repo.profile(e.pubkey);const old=h.repo.peekProfile(e.pubkey);h.fail[relay]='rate-limited: fixture';
 await assert.rejects(h.repo.profile(e.pubkey,{fresh:true}),/全リレー/);assert.deepEqual(h.repo.peekProfile(e.pubkey),old);
 assert.equal((await h.cache.get(e.pubkey)).event.id,e.id);
});
test('Warm known anonymous authors cause neither relay reads nor profile writes',async t=>{
 const h=setup(t);await h.repo.decorate(d.pages[0],null);const writes=h.cache.stats.writes,n=h.requests().length;
 await h.repo.decorate(d.pages[1],null);assert.equal(h.cache.stats.writes,writes);assert.equal(h.requests().length,n);
});
test('Posts, follow, mute and relay lists are never reused on repeated explicit reads',async t=>{
 const h=setup(t);
 for(const kind of [1,3,10000,10002]){const n=h.requests().length;await h.repo.replacement(kind,e.pubkey);await h.repo.replacement(kind,e.pubkey);assert.equal(h.requests().length,n+2);}
 assert.equal(h.local.map.size,0);
});
test('Navigation also clears current-account contacts, mutes and relays from runtime view state',async t=>{
 const h=setup(t);for(const kind of [3,10000,10002])await h.repo.accept({...e,kind});
 h.repo.beginView(e.pubkey);assert.equal(h.repo.replacements.size,0);assert.equal(h.repo.events.size,0);
});
test('All metadata consumers share persistence after repository reset, logout, and relay-setting change',async t=>{
 const h=setup(t);await h.repo.profiles(d.profiles.map(e=>e.pubkey));const n=h.requests().length;
 h.repo.resetSession();h.repo.beginView(d.user);
 const second=new Repository(h.storage,h.pool,{value:{...settings.value,relays:['wss://other.example/']}},{profileCache:new ProfileCache({indexedDB:null,localStorage:h.local})});
 await second.decorate(d.pages[0],null);await second.profiles(d.profiles.map(e=>e.pubkey));await second.profile(e.pubkey);
 assert.equal(h.requests().length,n);
});
test('NIP-05 verification is persisted once, event/pubkey bound, and refreshed only explicitly',async t=>{
 const h=fakeRelay({events:f.events});t.after(()=>h.close());const local=disk();let http=0;
 const verifier={verify:async()=>{http++;return {state:'valid',reason:'fixture',checked:Date.now()};}};
 const make=()=>new Repository(h.storage,h.pool,settings,{profileCache:new ProfileCache({indexedDB:null,localStorage:local}),verifier});
 const a=make();await a.profile(f.keys.alice);await a.profile(f.keys.alice);assert.equal(http,1);
 const b=make();await b.profile(f.keys.alice);assert.equal(http,1);assert.equal(b.verification(f.keys.alice).pubkey,f.keys.alice);
 await b.profile(f.keys.alice,{fresh:true});assert.equal(http,2);
});
test('A cached NIP-05 failure does not trigger repeated verification on every display',async t=>{
 const h=fakeRelay({events:f.events});t.after(()=>h.close());let http=0;
 const repo=new Repository(h.storage,h.pool,settings,{profileCache:new ProfileCache({indexedDB:null,localStorage:disk()}),verifier:{verify:async()=>{http++;return {state:'unknown',reason:'CORS',checked:1};}}});
 await repo.profile(f.keys.alice);await repo.profile(f.keys.alice);assert.equal(http,1);
 await repo.profile(f.keys.alice,{fresh:true});assert.equal(http,2);
});
test('Verification record for another pubkey or event cannot be reused as a badge',async()=>{
 const cache=new ProfileCache({indexedDB:null,localStorage:disk()});const r=await cache.put(e,{verification:{state:'valid',eventId:e.id,pubkey:d.profiles[1].pubkey,identifier:'a@example.com'}});
 assert.equal(r.verification,null);
});
test('Storage-full failure is visible, nonfatal and not reported as a successful persistent write',async()=>{
 let warnings=0;const cache=new ProfileCache({indexedDB:null,localStorage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},onError:()=>warnings++});
 assert.equal((await cache.put(e)).event.id,e.id);await cache.put(e);assert.equal(warnings,1);assert.equal(cache.stats.writes,0);assert.equal(await cache.get(e.pubkey),null);
});
test('IndexedDB branch uses only profiles store and survives a closed/reopened cache (API fixture)',async()=>{
 const indexedDB=idbFixture(),a=new ProfileCache({indexedDB,localStorage:null});await a.put(e);await a.close();
 const b=new ProfileCache({indexedDB,localStorage:null});assert.equal((await b.get(e.pubkey)).event.id,e.id);
 assert.ok(indexedDB.calls.filter(c=>c.method==='transaction').every(c=>c.store==='profiles'));await b.close();
});
test('Concurrent IndexedDB profile refresh transactions cannot downgrade a newer version (API fixture)',async()=>{
 const indexedDB=idbFixture(),a=new ProfileCache({indexedDB,localStorage:null}),b=new ProfileCache({indexedDB,localStorage:null});
 await a.put(e);await Promise.all([a.put(d.updated,{replace:true}),b.put(e,{replace:true})]);
 assert.equal((await b.get(e.pubkey)).event.id,d.updated.id);await a.close();await b.close();
});
test('IndexedDB transaction abort is surfaced without crashing profile rendering (API fixture)',async()=>{
 const indexedDB=idbFixture();indexedDB.failWrites=true;let warnings=0;
 const cache=new ProfileCache({indexedDB,localStorage:null,onError:()=>warnings++});
 await cache.put(e);assert.equal(warnings,1);assert.equal(cache.stats.writes,0);await cache.close();
});
test('Persistent profile survives an actual separate Node process with disk-backed storage adapter',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mikeryan-profile-')),file=path.join(dir,'storage.json');
 try {
   const local={getItem:k=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file))[k]??null:null,setItem:(k,v)=>{const m=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};m[k]=v;fs.writeFileSync(file,JSON.stringify(m));}};
   await new ProfileCache({indexedDB:null,localStorage:local}).put(e);
   const script=`import fs from 'node:fs';import {ProfileCache} from ${JSON.stringify(new URL('../js/profiles/cache.js',import.meta.url).href)};const local={getItem:k=>JSON.parse(fs.readFileSync(${JSON.stringify(file)}))[k]??null};const c=new ProfileCache({indexedDB:null,localStorage:local});const r=await c.get(${JSON.stringify(e.pubkey)});if(!r||r.event.id!==${JSON.stringify(e.id)})process.exit(1);console.log('restored');`;
   const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/restored/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('Blocked browser storage getters degrade to memory without crashing construction',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('SecurityError');}});
  let warnings=0;const cache=new ProfileCache({indexedDB:null,onError:()=>warnings++});
  await cache.put(e);assert.equal(cache.mode,'memory');assert.equal(warnings,1);assert.equal((await cache.get(e.pubkey)).event.id,e.id);
 }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});
test('Evicted hot profile is restored from the persistent store with zero relay requests',async t=>{
 const h=setup(t);await h.repo.profile(e.pubkey);const n=h.requests().length;
 for(let i=0;i<2001;i++)h.repo.installProfile({event:{...e,pubkey:i.toString(16).padStart(64,'0')},verification:null});
 assert.equal(h.repo.knownProfile(e.pubkey),null);
 await h.repo.profile(e.pubkey);assert.equal(h.repo.knownProfile(e.pubkey).id,e.id);assert.equal(h.requests().length,n);
});
