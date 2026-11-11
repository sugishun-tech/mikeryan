/** Notification-only NIP-25 reply tests. Only public deterministic fixture keys are used.
 * npm test needs Node only. Re-sign recorded templates with
 * python3 tests/generate_reaction_replies_fixture.py (cryptography required).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Session} from '../js/auth/session.js';
import {Social} from '../js/social/service.js';
import {Repository} from '../js/core/repository.js';
import {Storage} from '../js/core/storage.js';
import {DEFAULTS} from '../js/core/config.js';
import {matchesFilter, stableJSON} from '../js/core/utils.js';
import {verifyEvent} from '../js/core/crypto.js';

const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url)));
const {alice,bob,carol}=fixtures.keys;
const original=fixtures.events.find(e=>e.kind===1&&e.pubkey===alice);
const otherPost=fixtures.events.find(e=>e.kind===1&&e.pubkey===bob);
const received=fixtures.events.find(e=>e.kind===7&&e.pubkey===bob);
const fixtureClock = (original.created_at + 100) * 1000;
const signatureFixtures = new Map(JSON.parse(fs.readFileSync(new URL('./fixtures/reaction-replies.json', import.meta.url))).map(row => [stableJSON([row.secret, row.template]), row.event]));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function signed(template, secret=3) {
  const event=signatureFixtures.get(stableJSON([secret,template]));
  assert.ok(event, 'Missing deterministic signature fixture: regenerate tests/fixtures/reaction-replies.json');
  return structuredClone(event);
}
const reaction=(tags,content='+',secret=4)=>signed({kind:7,content,tags,created_at:original.created_at+40},secret);
const ownLike=(target,content='+',tags=null)=>reaction(tags??[['e',target.id],['p',target.pubkey],['k','7']],content,3);
function browser(t,{disk=new Map(),locks=true}={}) {
  t.mock.method(Date, 'now', () => fixtureClock);
  const descriptors=new Map(['window','localStorage','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const lockQueues=new Map();
  const request=(name,task)=>{
    const run=(lockQueues.get(name)??Promise.resolve()).catch(()=>{}).then(()=>task());
    lockQueues.set(name,run);return run;
  };
  const storage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,String(v)),removeItem:k=>disk.delete(k)};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:locks?{locks:{request}}:{}});
  t.after(()=>{for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {disk,storage,request};
}
function harness({source=[...fixtures.events],diskPrefix='reaction-tests',queryHook,publishHook,signHook}={}) {
  const calls={queries:[],publishes:[],signs:[]};
  const settings={value:{...DEFAULTS,relays:['wss://a.example/','wss://b.example/'],readRelayCount:1,requestGapMs:800}};
  const session=new Session();session.pubkey=alice;session.connected=true;
  session.extension=async()=>({getPublicKey:async()=>session.pubkey,signEvent:async template=>{
    calls.signs.push(structuredClone(template));
    if(signHook)return signHook(template);
    return signed(template);
  }});
  const storage=new Storage(diskPrefix);
  const network={
    async query(payload) {
      calls.queries.push(structuredClone(payload));
      if(queryHook)return queryHook(payload);
      const selected=new Map();
      for(const filter of payload.filters)for(const event of source.filter(e=>matchesFilter(e,filter)).sort((a,b)=>b.created_at-a.created_at).slice(0,filter.limit??Infinity))selected.set(event.id,event);
      return {events:[...selected.values()],complete:true,errors:[]};
    },
    async publish(payload) {
      calls.publishes.push(structuredClone(payload));
      assert.equal(await verifyEvent(payload.event),true,'only valid signed events reach transport');
      if(publishHook)return publishHook(payload);
      source.push(payload.event);
      return {results:payload.relays.map(relay=>({relay,accepted:true}))};
    }
  };
  const repo=new Repository(storage,network,settings);
  const social=new Social(repo,session,settings,storage,network);
  return {social,replies:social.reactionReplies,session,storage,repo,settings,network,source,calls};
}

// The first p/e tags are ancestors, not the direct reaction target.
test('Only other-authored kind:7 directly addressed to this account is eligible',t=>{
  browser(t);const h=harness();
  assert.equal(h.replies.eligible(received),true);
  for(const bad of [original,{...received,kind:1},{...received,kind:6},{...received,kind:16},
    {...received,pubkey:alice},{...received,tags:[['e',original.id],['p',alice],['p',bob]]},
    {...received,tags:[['e',original.id],['p',alice],['e','bad-id']]},
    {...received,tags:[['e',original.id]]}])assert.equal(h.replies.eligible(bad),false);
});
test('Preparing normal posts does not start reaction queries or signing',async t=>{
  browser(t);const h=harness();await h.replies.prepare([original,otherPost]);
  assert.equal(h.calls.queries.length,0);assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('A reply like references the received reaction itself with one e, one p and k:7',async t=>{
  browser(t);const h=harness();const event=await h.replies.like(received);
  assert.equal(event.kind,7);assert.equal(event.content,'+');assert.equal(event.pubkey,alice);
  const tags=type=>event.tags.filter(t=>t[0]===type);
  assert.equal(tags('e').length,1);assert.equal(tags('e')[0][1],received.id);
  assert.equal(tags('p').length,1);assert.equal(tags('p')[0][1],bob);
  assert.deepEqual(tags('k'),[['k','7']]);
  assert.equal(event.tags.some(t=>t[0]==='e'&&t[1]===original.id),false);
  assert.equal(event.tags.some(t=>t[0]==='p'&&t[1]===alice),false);
  assert.equal(h.replies.state(received).status,'liked');
  assert.equal(h.calls.signs.length,1);assert.equal(h.calls.publishes.length,1);
  const checks=h.calls.queries.filter(c=>c.filters.some(f=>f.kinds?.includes(7)&&f.authors?.includes(alice)));
  assert.ok(checks.length>0);assert.ok(checks.every(c=>c.relays.length===2),'dedup reads include all write relays');
  assert.ok(checks.every(c=>c.filters.every(f=>f['#e'].includes(received.id))));
});
for(const content of ['+','','🎉',':wave:'])test(`Incoming reaction content ${JSON.stringify(content)} can receive a normal like`,async t=>{
  browser(t);const target=reaction([['e',original.id],['p',alice]],content);
  const h=harness({source:[...fixtures.events,target]});await h.replies.like(target);
  assert.equal(h.calls.signs[0].content,'+');assert.equal(h.replies.state(target).status,'liked');
});
for(const content of ['+',''])test(`Existing ${JSON.stringify(content)} like is red without another signature`,async t=>{
  browser(t);const existing=ownLike(received,content),h=harness({source:[...fixtures.events,existing]});
  await h.replies.prepare([received]);assert.equal(h.replies.state(received).status,'liked');
  await h.replies.like(received);assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('An earlier e match, another author, or an emoji is not mistaken for an existing like',async t=>{
  browser(t);const source=[...fixtures.events,
    ownLike(received,'+',[['e',received.id],['e',otherPost.id],['p',bob]]),
    ownLike(received,'❤️'),reaction([['e',received.id],['p',bob]],'+',5)];
  const h=harness({source});await h.replies.prepare([received]);assert.notEqual(h.replies.state(received).status,'liked');
  await h.replies.like(received);assert.equal(h.calls.signs.length,1);
});
test('Concurrent clicks share one signature and one transport operation',async t=>{
  browser(t);const gate=deferred(),started=deferred();const h=harness({signHook:async template=>{started.resolve();await gate.promise;return signed(template);}});
  const a=h.replies.like(received),b=h.replies.like(received);await started.promise;gate.resolve();await Promise.all([a,b]);
  assert.equal(h.calls.signs.length,1);assert.equal(h.calls.publishes.length,1);
});
test('A confirmed authored reply survives reload even when relays no longer return it',async t=>{
  browser(t);const first=harness();await first.replies.like(received);
  const second=harness();await second.replies.prepare([received]);assert.equal(second.replies.state(received).status,'liked');
  await second.replies.like(received);assert.equal(second.calls.signs.length,0);assert.equal(second.calls.publishes.length,0);
});
test('Concurrent tabs serialize by account and retain one reply event',async t=>{
  browser(t);const first=harness(),second=harness();await Promise.all([first.replies.like(received),second.replies.like(received)]);
  assert.equal(first.calls.signs.length+second.calls.signs.length,1);
  assert.equal(first.calls.publishes.length+second.calls.publishes.length,1);
});
test('Incomplete own-like lookup cannot be treated as permission to sign a new like',async t=>{
  browser(t);const h=harness({queryHook:async()=>({events:[],complete:false,errors:[{relay:'wss://b.example/',reason:'offline'}]})});
  await assert.rejects(h.replies.like(received));assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('Spoofing a p tag does not make somebody else’s post an incoming reaction',async t=>{
  browser(t);const spoof=reaction([['e',otherPost.id],['p',alice]]);const h=harness({source:[...fixtures.events,spoof]});
  await assert.rejects(h.replies.like(spoof));assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('A tampered incoming reaction fails signature verification before any send',async t=>{
  browser(t);const h=harness();await assert.rejects(h.replies.like({...received,content:'tampered'}));
  assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('Lost relay acknowledgements retain one exact signed reply for manual retry',async t=>{
  browser(t);let fail=true;const h=harness({publishHook:async({relays})=>({results:relays.map(relay=>({relay,accepted:!fail,reason:fail?'lost acknowledgement':''}))})});
  await assert.rejects(h.replies.like(received));assert.equal(h.replies.state(received).status,'pending');
  const rows=await h.replies.pendingRows();assert.equal(rows.length,1);const event=rows[0].event;
  await h.replies.like(received).catch(()=>{});assert.equal(h.calls.signs.length,1);assert.equal(h.calls.publishes.length,1);
  fail=false;await h.replies.retry(event);
  assert.equal(h.calls.signs.length,1);assert.equal(h.calls.publishes.length,2);
  assert.deepEqual(h.calls.publishes[1].event,h.calls.publishes[0].event);
  assert.equal(h.replies.state(received).status,'liked');assert.equal((await h.replies.pendingRows()).length,0);
});
test('Partial acceptance turns the heart red and retry targets only failed relays',async t=>{
  browser(t);let first=true;const h=harness({publishHook:async({relays})=>{const results=relays.map((relay,i)=>({relay,accepted:!first||i===0,reason:i?'offline':''}));first=false;return {results};}});
  await h.replies.like(received);assert.equal(h.replies.state(received).status,'liked');
  const pending=await h.replies.pendingRows();assert.equal(pending.length,1);await h.replies.retry(pending[0].event);
  assert.deepEqual(h.calls.publishes[1].relays,['wss://b.example/']);assert.equal(h.calls.signs.length,1);
});
test('Without durable storage no signed reply reaches the network',async t=>{
  const env=browser(t);env.storage.setItem=()=>{throw Error('quota');};const h=harness();
  await assert.rejects(h.replies.like(received));assert.equal(h.calls.publishes.length,0);
});
test('Without cross-tab locking a new reply fails closed',async t=>{
  browser(t,{locks:false});const h=harness();await assert.rejects(h.replies.like(received));
  assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('Account switch during lookup does not sign or publish for either account',async t=>{
  browser(t);const gate=deferred(),started=deferred();const h=harness({queryHook:async()=>{started.resolve();await gate.promise;return {events:[],complete:true,errors:[]};}});
  const job=h.replies.like(received);await started.promise;h.session.pubkey=carol;h.session.epoch++;gate.resolve();
  await assert.rejects(job);assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('Signer refusal leaves no pending delivery and a later explicit attempt can work',async t=>{
  browser(t);let deny=true;const h=harness({signHook:async template=>{if(deny)throw Error('User rejected');return signed(template);}});
  await assert.rejects(h.replies.like(received),/rejected/);assert.equal((await h.replies.pendingRows()).length,0);
  deny=false;await h.replies.like(received);assert.equal(h.calls.publishes.length,1);assert.equal(h.replies.state(received).status,'liked');
});
test('Generic publish, sendSigned and retry still reject arbitrary kind:7 events',async t=>{
  browser(t);const h=harness(),event=ownLike(received);
  for(const method of ['publish','sendSigned','retry'])await assert.rejects(h.social[method](event));
  assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});

test('Pending reply survives a fresh instance and missing generic outbox without creating a new event',async t=>{
  browser(t);const first=harness({publishHook:async({relays})=>({results:relays.map(relay=>({relay,accepted:false,reason:'unknown result'}))})});
  await assert.rejects(first.replies.like(received));const exact=first.calls.publishes[0].event;
  await first.storage.delete(`outbox:${alice}`);
  const second=harness();await second.replies.prepare([received]);assert.equal(second.replies.state(received).status,'pending');
  await assert.rejects(second.replies.like(received));assert.equal(second.calls.signs.length,0);assert.equal(second.calls.publishes.length,0);
  const rows=await second.replies.pendingRows();assert.equal(rows.length,1);assert.deepEqual(rows[0].event,exact);
  await second.replies.retry(exact);assert.equal(second.calls.signs.length,0);assert.deepEqual(second.calls.publishes[0].event,exact);
});
test('Concurrent different targets preserve both authored records under the account lock',async t=>{
  browser(t);const another=reaction([['e',original.id],['p',alice]],'🔔');const first=harness({source:[...fixtures.events,another]}),second=harness({source:[...fixtures.events,another]});
  await Promise.all([first.replies.like(received),second.replies.like(another)]);
  const reloaded=harness();await reloaded.replies.prepare([received,another]);
  assert.equal(reloaded.replies.state(received).status,'liked');assert.equal(reloaded.replies.state(another).status,'liked');
  assert.equal(first.calls.signs.length+second.calls.signs.length,2);
});
test('A modified persistent receipt cannot authorize retry or a fresh reply',async t=>{
  browser(t);const h=harness();await h.replies.like(received);
  const key=`reaction-replies:${alice}`,records=await h.storage.get(key);records[received.id].event.content='modified';await h.storage.set(key,records,null);
  const fresh=harness();await assert.rejects(fresh.replies.like(received));await assert.rejects(fresh.replies.retry(records[received.id].event));
  assert.equal(fresh.calls.publishes.length,0);assert.equal(fresh.calls.signs.length,0);
});
test('Account switch while a signing prompt is outstanding discards its signed result',async t=>{
  browser(t);const started=deferred(),gate=deferred();const h=harness({signHook:async template=>{started.resolve();await gate.promise;return signed(template);}});
  const job=h.replies.like(received);await started.promise;h.session.pubkey=carol;h.session.epoch++;gate.resolve();
  await assert.rejects(job);assert.equal(h.calls.publishes.length,0);assert.equal((await h.storage.get(`reaction-replies:${alice}`)),undefined);
});
test('Retry stops before transport when the durable ledger cannot be rewritten',async t=>{
  const env=browser(t);const h=harness({publishHook:async({relays})=>({results:relays.map(relay=>({relay,accepted:false,reason:'offline'}))})});
  await assert.rejects(h.replies.like(received));const event=h.calls.publishes[0].event;
  env.storage.setItem=()=>{throw Error('quota');};
  await assert.rejects(h.replies.retry(event));assert.equal(h.calls.signs.length,1);assert.equal(h.calls.publishes.length,1);
});
test('Unreadable authored ledger fails closed instead of being treated as empty',async t=>{
  const env=browser(t);const h=harness();env.storage.getItem=key=>{if(key.includes('reaction-replies:'))throw Error('storage blocked');return env.disk.get(key)??null;};
  await assert.rejects(h.replies.like(received));assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('Malformed authored-ledger JSON fails closed instead of being treated as empty',async t=>{
  const env=browser(t);const h=harness();env.disk.set(h.storage.prefix+`reaction-replies:${alice}`,'{broken json');
  await assert.rejects(h.replies.like(received));assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('A tab with a failed ledger write cannot overwrite newer records from another tab',async t=>{
  const env=browser(t),write=env.storage.setItem;
  const first=harness({publishHook:async({relays})=>{env.storage.setItem=()=>{throw Error('quota');};return {results:relays.map(relay=>({relay,accepted:true}))};}});
  await first.replies.like(received);assert.equal(first.calls.publishes.length,1);
  env.storage.setItem=write;
  const another=reaction([['e',original.id],['p',alice]],'🔔');
  const second=harness({source:[...fixtures.events,another]});await second.replies.like(another);
  await assert.rejects(first.replies.like(another));await assert.rejects(first.replies.retry(first.calls.publishes[0].event));
  assert.equal(first.calls.signs.length,1);assert.equal(first.calls.publishes.length,1);
  const fresh=harness();const records=await fresh.storage.get(`reaction-replies:${alice}`);
  assert.equal(records[another.id].event.id,second.calls.publishes[0].event.id);
  assert.equal(records[received.id].event.id,first.calls.publishes[0].event.id);
});

test('A verified remote like remains liked when a later relay response is empty',async t=>{
  browser(t);const existing=ownLike(received),h=harness({source:[...fixtures.events,existing]});
  await h.replies.prepare([received]);assert.equal(h.replies.state(received).status,'liked');
  h.source.splice(h.source.findIndex(event=>event.id===existing.id),1);
  await h.replies.prepare([received]);assert.equal(h.replies.state(received).status,'liked');
  await h.replies.like(received);assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
test('A saturated exact-target lookup does not treat an unobserved like as absent',async t=>{
  browser(t);
  const saturated=Array.from({length:100},(_,i)=>signed({kind:7,content:'🎉',
    tags:[['e',received.id],['p',received.pubkey],['k','7']],created_at:original.created_at-200+i},3));
  assert.equal(new Set(saturated.map(event=>event.id)).size,100);
  assert.ok((await Promise.all(saturated.map(event=>verifyEvent(event)))).every(Boolean));
  const h=harness({source:[...fixtures.events,...saturated]});
  await assert.rejects(h.replies.like(received));assert.equal(h.calls.signs.length,0);assert.equal(h.calls.publishes.length,0);
});
