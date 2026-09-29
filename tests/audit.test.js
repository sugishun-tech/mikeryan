/** Fault-injection regressions: no real account, extension or public relay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Session } from '../js/auth/session.js';
import { Social, pubkeys } from '../js/social/service.js';
import { Storage, local } from '../js/core/storage.js';
import { Settings, validateSettings } from '../js/settings/store.js';
import { Repository } from '../js/core/repository.js';
import { ProfileCache } from '../js/profiles/cache.js';
import { RelayConnection } from '../js/network/relay.js';
import { Emitter, sleep } from '../js/core/utils.js';
import { DEFAULTS } from '../js/core/config.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url)));
const {alice,bob,carol}=fixture.keys;
const note=fixture.events.find(e=>e.kind===1&&e.pubkey===alice);
const metadata=fixture.events.find(e=>e.kind===0&&e.pubkey===alice);
const key=n=>n.toString(16).padStart(64,'0');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function browser(t){
 const previous=globalThis.window,ls=globalThis.localStorage,values=new Map();
 globalThis.window={};globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;if(ls===undefined)delete globalThis.localStorage;else globalThis.localStorage=ls;});
 return values;
}
function socialHarness({read=async()=>null,publish,storage}={}){
 const repo=new Emitter();repo.replacements=new Map();repo.generation=0;repo.replacement=read;repo.published=async e=>repo.replacements.set(`${e.kind}:${e.pubkey}`,e);
 const signed=[];const session={pubkey:alice,epoch:0,sign:async template=>{const e={...template,pubkey:session.pubkey,id:key(signed.length+101)};signed.push(e);return e;}};
 const values=new Map();storage??={get:async k=>structuredClone(values.get(k)),set:async(k,v)=>{await tick();values.set(k,structuredClone(v));return true;}};
 const network={publish:publish??(async({relays})=>({accepted:relays.length,total:relays.length,results:relays.map(relay=>({relay,accepted:true}))}))};
 const social=new Social(repo,session,{value:{...DEFAULTS,relays:['wss://a.example/','wss://b.example/']}},storage,network);
 return {repo,session,social,network,storage,signed,values};
}
test('Pending login cannot undo an explicit logout',async t=>{
 browser(t);const gate=deferred(),started=deferred();window.nostr={getPublicKey:()=>{started.resolve();return gate.promise;},signEvent:async()=>{}};
 const s=new Session(),job=s.login();await started.promise;s.logout();gate.resolve(alice);
 await assert.rejects(job,/ログアウト|変更|中止/);assert.equal(s.pubkey,null);assert.equal(local.get('pubkey'),null);
});
test('A stale login cannot overwrite a newer login attempt',async t=>{
 browser(t);const first=deferred(),started=deferred();let calls=0;
 window.nostr={getPublicKey:()=>{if(++calls===1){started.resolve();return first.promise;}return bob;},signEvent:async()=>{}};
 const s=new Session(),old=s.login();const oldResult=old.catch(e=>e);await started.promise;s.logout();const recent=s.login();first.resolve(alice);
 await recent;await oldResult;assert.equal(s.pubkey,bob);assert.equal(calls,2);
});
test('Queued signing snapshots the requested body and tags at click time',async t=>{
 browser(t);const s=new Session();s.pubkey=alice;s.connected=true;
 let requested;window.nostr={getPublicKey:async()=>alice,signEvent:async unsigned=>{requested=unsigned;return note;}};
 const template={kind:note.kind,created_at:note.created_at,tags:structuredClone(note.tags),content:note.content};
 const job=s.sign(template);template.content='changed after enqueue';template.tags.push(['changed','yes']);
 await job;assert.equal(requested.content,note.content);assert.deepEqual(requested.tags,note.tags);
});
test('Logout and login to the same key invalidate an older signing operation',async t=>{
 browser(t);const gate=deferred(),started=deferred();const s=new Session();s.pubkey=alice;s.connected=true;
 window.nostr={getPublicKey:async()=>alice,signEvent:()=>{started.resolve();return gate.promise;}};
 const job=s.sign(note);await started.promise;s.logout();await s.login();gate.resolve(note);
 await assert.rejects(job,/変更|中止|一致/);
});
test('Account changes during signature verification are checked again before return',async t=>{
 browser(t);const gate=deferred(),started=deferred();const s=new Session();s.pubkey=alice;s.connected=true;
 window.nostr={getPublicKey:async()=>alice,signEvent:async()=>note};
 const digest=crypto.subtle.digest.bind(crypto.subtle);let first=true;
 t.mock.method(crypto.subtle,'digest',async(...args)=>{if(first){first=false;started.resolve();await gate.promise;}return digest(...args);});
 const job=s.sign(note);await started.promise;s.pubkey=bob;gate.resolve();
 await assert.rejects(job,/変更|中止|一致/);
});
for(const operation of ['follow','profile'])test(`${operation}: delayed read cannot sign old-account data using a new account`,async()=>{
 const gate=deferred(),started=deferred();const h=socialHarness({read:()=>{started.resolve();return gate.promise;}});
 const job=operation==='follow'?h.social.toggleFollow(carol):h.social.editProfile({about:'old account edit'});
 await started.promise;h.session.pubkey=bob;h.session.epoch++;gate.resolve(operation==='follow'?{kind:3,pubkey:alice,tags:[['p',bob]],content:'',created_at:1}:metadata);
 await assert.rejects(job,/アカウント|変更/);assert.equal(h.signed.length,0);
});
test('A successful old-view account read cannot overwrite a newer received follow list',async()=>{
 const gate=deferred(),h=socialHarness({read:async kind=>kind===3?gate.promise:null});h.repo.profile=async()=>({});
 const old={id:key(1),kind:3,pubkey:alice,created_at:1,tags:[],content:''};
 const newer={...old,id:key(2),created_at:2,tags:[['p',bob]]};
 const load=h.social.loadAccount();h.repo.replacements.set(`3:${alice}`,newer);h.repo.emit('replace',{event:newer});gate.resolve(old);await load;
 assert.equal(h.social.following.has(bob),true);
});
test('Follow read-modify-write preserves a newer signed current-view list',async()=>{
 const old={kind:3,pubkey:alice,id:key(1),created_at:1,tags:[],content:''};
 const h=socialHarness({read:async()=>old});h.repo.replacements.set(`3:${alice}`,{...old,id:key(2),created_at:2,tags:[['p',bob]],content:'keep me'});
 await h.social.toggleFollow(carol);assert.deepEqual(new Set(pubkeys(h.signed[0])),new Set([bob,carol]));assert.equal(h.signed[0].content,'keep me');
});
test('Concurrent incomplete sends retain both signed events in the outbox',async()=>{
 const h=socialHarness({publish:async({relays})=>({accepted:1,total:2,results:relays.map((relay,i)=>({relay,accepted:!i,reason:i?'offline':''}))})});
 await Promise.all([h.social.sendSigned({...note,id:key(1)}),h.social.sendSigned({...note,id:key(2)})]);
 assert.equal((await h.storage.get(`outbox:${alice}`)).length,2);
});
test('A transport exception after signing preserves the exact event for retry',async()=>{
 const h=socialHarness({publish:async()=>{throw Error('worker stopped');}});await assert.rejects(h.social.sendSigned(note));
 const box=await h.storage.get(`outbox:${alice}`);assert.equal(box?.length,1);assert.equal(box[0].event.id,note.id);
});
test('Concurrent retries of one event share one send operation',async()=>{
 const gate=deferred();let sends=0;const h=socialHarness({publish:async({relays})=>{sends++;await gate.promise;return {accepted:1,total:1,results:relays.map(relay=>({relay,accepted:true}))};}});
 await h.storage.set(`outbox:${alice}`,[{event:note,time:Date.now(),results:[{relay:'wss://a.example/',accepted:false}]}]);
 const a=h.social.retry(note),b=h.social.retry(note);await tick();await tick();gate.resolve();await Promise.all([a,b]);assert.equal(sends,1);
});
test('Outbox removes acknowledgements completed in another tab, not stale memory',async t=>{
 const values=browser(t),storage=new Storage('audit');await storage.set('outbox:test',[{event:'x'}]);values.delete(storage.prefix+'outbox:test');
 assert.equal(await storage.get('outbox:test'),undefined);
});
test('A failed persistent write remains readable from the current tab instead of stale disk',async t=>{
 browser(t);const s=new Storage('audit');await s.set('outbox:test',['old']);localStorage.setItem=()=>{throw Error('quota');};await s.set('outbox:test',['new']);
 assert.deepEqual(await s.get('outbox:test'),['new']);
});
test('State storage reports failed persistence instead of silently claiming success',async t=>{
 browser(t);localStorage.setItem=()=>{throw Error('quota');};assert.equal(await new Storage('audit').set('outbox:test',[]),false);
});
test('A failed profile write cannot downgrade a newer known record',async()=>{
 const values=new Map(),ls={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const c=new ProfileCache({indexedDB:null,localStorage:ls,verify:async()=>true});const newer={...metadata,created_at:metadata.created_at+1,id:key(9)};
 await c.put(newer);ls.setItem=()=>{throw Error('quota');};const chosen=await c.put(metadata,{replace:true});assert.equal(chosen.event.id,newer.id);
});
test('Profile persistence failure retains current-session metadata for reload within the tab',async()=>{
 const ls={getItem:()=>null,setItem:()=>{throw Error('quota');}};
 const c=new ProfileCache({indexedDB:null,localStorage:ls,verify:async()=>true});await c.put(metadata);
 assert.equal((await c.get(alice))?.event.id,metadata.id);
});
for(const input of [null,[],42,'broken',{relays:'wss://example.com'},{muteContentPatterns:'x'},{loadImages:'false'}])test(`Malformed settings are rejected without replacing saved settings: ${JSON.stringify(input)}`,()=>{
 assert.throws(()=>validateSettings(input));
});
test('Legacy settings migration remains usable when persistence is denied',async t=>{
 const values=browser(t);values.set('nostr_relays','wss://a.example/');localStorage.setItem=()=>{throw Error('quota');};
 const settings=new Settings();await settings.load();assert.deepEqual(settings.value.relays,['wss://a.example/']);
});
test('A queued event lookup does not start new traffic after its view is disposed',async()=>{
 let calls=0;const repo=new Repository(new Storage(),{query:async()=>{calls++;return {events:[note],complete:true,errors:[]};}},{value:{...DEFAULTS}});
 const job=repo.event(note.id);const outcome=job.catch(e=>e);repo.beginView(bob);await outcome;assert.equal(calls,0);assert.equal(repo.events.size,0);
});
test('Event lookup failures remain retryable errors rather than false not-found results',async()=>{
 const repo=new Repository(new Storage(),{query:async()=>({events:[],complete:false,errors:[{reason:'offline'}]})},{value:{...DEFAULTS}});
 await assert.rejects(repo.event(note.id),/取得|確認|通信/);
});
test('A late CLOSE from an old socket does not fail a replacement socket request',async t=>{
 const sockets=[];const storage={get:async()=>null,set:async()=>{},delete:async()=>{}};
 class Socket {constructor(){this.readyState=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}send(){}close(){this.readyState=3;}}
 const c=new RelayConnection('wss://a.example/',storage,{socketFactory:()=>new Socket(),gap:0,timeout:100});t.after(()=>c.close());
 await c.connect();const old=sockets[0];c.close();const pending=c.query([{kinds:[1],limit:1}]);const outcome=pending.catch(e=>e);
 while(sockets.length<2||!c.pending.size)await tick();old.onclose?.();const id=[...c.pending.keys()][0];
 if(id)sockets[1].onmessage({data:JSON.stringify(['EOSE',id])});const result=await outcome;
 assert.ok(Array.isArray(result));
});
test('Invalid signed contact response is not a confirmed empty public list',async t=>{
 const storage={get:async()=>null,set:async()=>{},delete:async()=>{}};
 class Socket {constructor(){this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.onopen();});}send(text){const m=JSON.parse(text);if(m[0]==='REQ')queueMicrotask(()=>{this.onmessage({data:JSON.stringify(['EVENT',m[1],{...note,kind:3,tags:[]}])});this.onmessage({data:JSON.stringify(['EOSE',m[1]])});});}close(){this.readyState=3;this.onclose?.();}}
 const c=new RelayConnection('wss://a.example/',storage,{socketFactory:()=>new Socket(),gap:0,timeout:100});t.after(()=>c.close());
 await assert.rejects(c.query([{kinds:[3],authors:[alice],limit:1}]),/署名|検証/);
});
test('Public relay edits preserve the newer signed current-view list over stale relay reads',async()=>{
 const old={kind:10002,pubkey:alice,id:key(1),created_at:1,tags:[['r','wss://a.example/']],content:''};
 const h=socialHarness({read:async()=>old});h.repo.replacements.set(`10002:${alice}`,{...old,id:key(2),created_at:2,tags:[...old.tags,['r','wss://kept.example/','read'],['custom','retain']],content:'retain content'});
 await h.social.changeRelay(alice,{action:'add',url:'wss://new.example/'});
 assert.equal(h.signed[0].tags.some(t=>t[0]==='r'&&t[1]==='wss://kept.example/'),true);assert.equal(h.signed[0].content,'retain content');assert.equal(h.signed[0].tags.some(t=>t[0]==='custom'),true);
});
test('Account switching during public relay preflight cannot sign the previous account edit',async()=>{
 const started=deferred(),gate=deferred(),h=socialHarness({read:()=>{started.resolve();return gate.promise;}});
 const job=h.social.changeRelay(alice,{action:'add',url:'wss://new.example/'});await started.promise;h.session.pubkey=bob;h.session.epoch++;gate.resolve({kind:10002,pubkey:alice,id:key(3),created_at:1,tags:[],content:''});await assert.rejects(job,/アカウント|変更/);assert.equal(h.signed.length,0);
});
test('Rejected signing is not stored as an unsigned outbox item and the next write can proceed',async()=>{
 const h=socialHarness();h.session.sign=async()=>{throw Error('User rejected');};await assert.rejects(h.social.post('text'),/rejected/);assert.equal(h.values.size,0);assert.equal(h.social.deliveries.size,0);
});
for(const content of ['{broken','null','[]','42'])test(`Profile editing rejects malformed latest JSON instead of erasing fields: ${content}`,async()=>{
 const h=socialHarness({read:async()=>({...metadata,content})});await assert.rejects(h.social.editProfile({name:'new name'}),/JSON|プロフィール/);assert.equal(h.signed.length,0);
});
