import test from 'node:test';
import assert from 'node:assert/strict';
import {Storage,local} from '../js/core/storage.js';
import {encodeKey,decodeKey,profileKey} from '../js/core/nip19.js';
import {parseRoute} from '../js/core/router.js';
import {normalizeRelay,replyTags,parentId,sortEvents,matchesFilter,stableJSON,sleep} from '../js/core/utils.js';
import {Settings,validateSettings} from '../js/settings/store.js';
import {Session} from '../js/auth/session.js';
import {Repository} from '../js/core/repository.js';
import {EventPager} from '../js/feed/pagination.js';
import {Nip05,parseIdentifier} from '../js/profiles/nip05.js';
import {DEFAULTS} from '../js/core/config.js';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url))),{alice,bob,carol}=fixture.keys;
const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
test('npub and note roundtrip with checksum / uppercase validation',()=>{
 for(const type of ['npub','note'])for(const key of [alice,bob,'0'.repeat(64),'f'.repeat(64)]){const v=encodeKey(type,key);assert.deepEqual(decodeKey(v),{type,data:key});assert.equal(decodeKey(v.toUpperCase()).data,key);assert.equal(decodeKey('nostr:'+v).data,key);assert.throws(()=>decodeKey(v.slice(0,-1)+(v.at(-1)==='q'?'p':'q')));}
 assert.throws(()=>profileKey(encodeKey('note',alice)));assert.throws(()=>decodeKey('nsec1abc'));assert.throws(()=>decodeKey(encodeKey('npub',alice).replace('npub','Npub')));
});
test('Hash / legacy routing supports a single project subpath',()=>{
 assert.deepEqual(parseRoute(`#/profile/${alice}/followers`),{view:'profile',pubkey:alice,tab:'followers'});
 assert.deepEqual(parseRoute('',`?npub=${encodeKey('npub',alice)}`),{view:'profile',pubkey:alice,tab:'posts'});
 assert.deepEqual(parseRoute('','?view=me'),{view:'me'});assert.deepEqual(parseRoute('','?settings=1'),{view:'settings'});
 assert.deepEqual(parseRoute('',`?view=thread&event=${alice}`),{view:'thread',id:alice});
 assert.deepEqual(parseRoute('#/home',`?hex=${bob}`),{view:'home'});
});
test('Safe URLs reject insecure remote WebSocket and credentials',()=>{
 assert.equal(normalizeRelay('ws://example.com'),null);assert.equal(normalizeRelay('wss://u:p@example.com'),null);assert.equal(normalizeRelay('javascript:alert(1)'),null);assert.ok(normalizeRelay('ws://127.0.0.1:1234'));assert.equal(normalizeRelay('wss://EXAMPLE.com'),'wss://example.com/');
});
test('NIP-10 direct and nested reply tags preserve root but exclude self',()=>{
 const root={id:alice,pubkey:bob,tags:[]};assert.equal(parentId({tags:replyTags(root,alice)}),alice);
 const reply={id:carol,pubkey:bob,tags:[['e',alice,'','root'],['p',alice]]};const tags=replyTags(reply,alice);
 assert.deepEqual(tags.filter(t=>t[0]==='e').map(t=>[t[1],t[3]]),[[alice,'root'],[carol,'reply']]);assert.ok(!tags.some(t=>t[0]==='p'&&t[1]===alice));
 assert.equal(parentId({tags:[['e',alice,'','mention']]}),null);
});
test('Settings validation, old-schema compatibility, and regular expression errors',()=>{
 const s=new Settings();const v=validateSettings({...DEFAULTS,readRelayCount:1});assert.equal(v.batchSize,30);assert.equal(v.readRelayCount,1);
 assert.throws(()=>validateSettings({...DEFAULTS,muteContentPatterns:['[']}));assert.throws(()=>validateSettings({...DEFAULTS,relays:[]}));
});
test('Persisted public key restores without asking extension again; logout stays out',async()=>{
 store.clear();let calls=0;globalThis.window={nostr:{getPublicKey:async()=>{calls++;return alice;},signEvent:async()=>{}}};
 const a=new Session();await Promise.all([a.login(),a.login()]);assert.equal(calls,1);
 const b=new Session();assert.equal(b.restore(),alice);assert.equal(calls,1);assert.equal(b.connected,false);
 b.logout();assert.equal(new Session().restore(),null);assert.equal([...store.values()].includes(alice),false);
});
test('Restored session refuses signing with another extension account',async()=>{
 store.clear();local.set('pubkey',alice);globalThis.window={nostr:{getPublicKey:async()=>bob,signEvent:async()=>{throw Error('must not sign');}}};
 const a=new Session();a.restore();await assert.rejects(a.sign({kind:1,tags:[],content:'x'}),/アカウント/);
});
test('Signature cancellation is not retried automatically',async()=>{
 let calls=0;globalThis.window={nostr:{getPublicKey:async()=>alice,signEvent:async()=>{calls++;throw Error('Denied by user');}}};const a=new Session();await a.login();await assert.rejects(a.sign({kind:1,tags:[],content:'x'}),/Denied/);assert.equal(calls,1);
});
test('Only relay cooldowns and pending user-authored sends can be persisted',async()=>{
 const s=new Storage();for(const key of ['query:x','event:x','latest:0:x','page:x','likes:x','nip05doc:x'])await assert.rejects(s.set(key,{}),/保存しません/);
 await s.set('health:x',{until:1},2);assert.deepEqual(await s.get('health:x'),{until:1});await sleep(5);assert.equal(await s.get('health:x'),undefined);
 await s.set('outbox:x',[{id:'pending'}]);assert.equal((await s.get('outbox:x')).length,1);await s.delete('outbox:x');assert.equal(await s.get('outbox:x'),undefined);
});
function repoHarness(){let calls=[];const storage=new Storage();const network={query:async q=>{calls.push(q);return {events:sortEvents(fixture.events.filter(e=>q.filters.some(f=>matchesFilter(e,f)))),complete:true,errors:[]};}};return {repo:new Repository(storage,network,{value:{...DEFAULTS}}),calls,storage};}
test('Concurrent profiles use one author-list filter; only explicit refresh re-fetches known profiles',async()=>{
 const {repo,calls}=repoHarness();await Promise.all([repo.profile(alice),repo.profile(bob),repo.profile(alice)]);
 assert.equal(calls.length,1);assert.equal(calls[0].filters.length,1);assert.equal(calls[0].filters[0].limit,2);
 assert.deepEqual(new Set(calls[0].filters[0].authors),new Set([alice,bob]));
 await repo.profile(alice);assert.equal(calls.length,1);
 await repo.profile(alice,{fresh:true});assert.equal(calls.length,2);
 await repo.profile('0'.repeat(64));await repo.profile('0'.repeat(64));assert.equal(calls.length,4);
});
test('Navigation discards posts but keeps positive session profiles without any storage writes',async()=>{
 const {repo,calls,storage}=repoHarness();await repo.profile(bob);repo.beginView(alice);assert.equal(repo.peekProfile(bob).name,'bob');assert.equal(repo.events.size,0);
 await repo.profile(bob);assert.equal(calls.length,1);assert.equal(storage.memory.size,0);
 repo.resetSession();await repo.profile(bob);assert.equal(calls.length,2);
});
test('Old replaceable events cannot overwrite newer current-screen metadata',async()=>{
 const {repo}=repoHarness();const old=fixture.events[0],fresh={...old,id:'0'.repeat(64),created_at:old.created_at+1,content:'{"name":"new"}'};
 await repo.accept(fresh);await repo.published(old);assert.equal(repo.peekProfile(alice).name,'new');
});
test('Read-modify-write refuses incomplete latest list reads',async()=>{
 const r=new Repository(new Storage(),{query:async()=>({events:[],complete:false,errors:[]})},{value:{...DEFAULTS}});await assert.rejects(r.replacement(3,alice,{all:true,fresh:true,required:true}),/全リレー/);
});
test('NIP-05 validates identifier and pubkey equality without response storage',async()=>{
 let calls=0,options;const n=new Nip05(new Storage(),{fetcher:async(u,o)=>{calls++;options=o;return new Response(JSON.stringify({names:{alice,bob}}));}});
 assert.equal((await n.verify('alice@example.com',alice)).state,'valid');assert.equal((await n.verify('alice@example.com',bob)).state,'invalid');assert.equal((await n.verify('bob@example.com',bob)).state,'valid');assert.equal(calls,3);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
 for(const id of ['@example.com','a@localhost','a@127.0.0.1','a@foo.local','a@-bad.com'])assert.equal(parseIdentifier(id),null);
});
test('NIP-05 singleflight and semaphore never exceed two concurrent requests',async()=>{
 let active=0,peak=0,calls=0;const n=new Nip05(new Storage(),{fetcher:async()=>{active++;calls++;peak=Math.max(peak,active);await sleep(10);active--;return new Response(JSON.stringify({names:{a:alice}}));}});
 await Promise.all([...Array.from({length:9},(_,i)=>n.verify(`a@domain${i}.com`,alice)),n.verify('a@domain0.com',bob)]);assert.equal(peak,2);assert.equal(calls,9);assert.equal(n.active,0);
});
test('NIP-05 CORS / HTTP failure remains unknown and does not suppress a subsequent request',async()=>{
 let calls=0;const n=new Nip05(new Storage(),{fetcher:async()=>{calls++;throw Error('CORS');}});assert.equal((await n.verify('a@example.com',alice)).state,'unknown');await n.verify('a@example.com',alice);assert.equal(calls,2);
});
