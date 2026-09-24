import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Repository} from '../js/core/repository.js';
import {compactProfileFilters, missingProfileFilters} from '../js/network/profile-batch.js';
import {canonicalFilters, stableJSON} from '../js/core/utils.js';
import {LIMITS, DEFAULTS} from '../js/core/config.js';
import {fakeRelay} from './helpers/relay-fixture.js';

const data = JSON.parse(fs.readFileSync(new URL('./fixtures/traffic.json', import.meta.url)));
const relay = 'wss://traffic.example/', second = 'wss://second.example/';
const authors = data.profiles.slice(0,30).map(e=>e.pubkey);
const individual = authors.map(author=>({kinds:[0],authors:[author],limit:1}));
function setup(t, options={}) {
  const h=fakeRelay({events:[...data.profiles,...data.pages.flat(),...data.reactions],...options});
  const settings={value:{...DEFAULTS,relays:[relay],readRelayCount:1,requestGapMs:0}};
  const repo=new Repository(h.storage,h.pool,settings);
  t.after(()=>h.close());return {...h,repo,settings};
}
const profileFilters = request => request.message.slice(2).filter(f=>f.kinds?.includes(0));
const kinds = request => request.message.slice(2).flatMap(f=>f.kinds??[]);

test('30 profile authors compact to one bounded filter; never widen ordinary limit/time/tag queries',()=>{
 const extra=[{kinds:[1],authors,limit:30},{kinds:[0],authors,limit:1},{kinds:[0],authors:[authors[0]],since:100,limit:1},{kinds:[0],authors:[authors[0]],'#p':[authors[1]],limit:1}];
 const compact=compactProfileFilters([...individual,...individual,...extra]);
 assert.equal(compact.length,5);assert.ok(compact.some(f=>f.kinds[0]===0&&f.limit===30&&f.authors.length===30));
 for(const f of canonicalFilters(extra))assert.ok(compact.some(g=>stableJSON(g)===stableJSON(f)));
});
test('A cold signed-in thirty-author page uses two REQs per relay, not three',async t=>{
 const h=setup(t);const page=await h.repo.query([{kinds:[1],ids:data.pages[0].map(e=>e.id),limit:30}]);
 const info=await h.repo.decorate(page.events,data.user);
 assert.equal(h.requests().length,2);assert.equal(h.requests()[1].message.length-2,2);
 assert.equal(info.events.filter(e=>e.kind===0).length,30);assert.equal(info.events.filter(e=>e.kind===7).length,30);
 assert.equal(h.pool.stats().relays[0].closes,2);assert.equal(h.pool.stats().relays[0].connections,1);
 assert.equal(h.storage.memory.size,0);
});
test('Known profiles are not re-requested; new page reactions remain a fresh scoped read',async t=>{
 const h=setup(t);await h.repo.decorate(data.pages[0],data.user);const before=h.requests().length;
 await h.repo.decorate(data.pages[1],data.user);const sent=h.requests().slice(before);
 assert.equal(sent.length,1);assert.deepEqual(kinds(sent[0]),[7]);
 assert.deepEqual(new Set(sent[0].message[2]['#e']),new Set(data.pages[1].map(e=>e.id)));
 await h.repo.decorate(data.pages[1],data.user);assert.equal(h.requests().length,before+2);
});
test('Mixed pages request only the ten unknown authors, plus one page-reaction filter',async t=>{
 const h=setup(t);await h.repo.decorate(data.pages[0],data.user);const before=h.requests().length;
 await h.repo.decorate(data.pages[2],data.user);const sent=h.requests().slice(before);
 assert.equal(sent.length,1);assert.equal(profileFilters(sent[0])[0].authors.length,10);
 assert.ok(profileFilters(sent[0])[0].authors.every(key=>!authors.includes(key)));
});
test('Anonymous warm decoration sends zero REQs; a subsequent explicit post read still sends one',async t=>{
 const h=setup(t);await h.repo.decorate(data.pages[0],null);const before=h.requests().length;
 await h.repo.decorate(data.pages[1],null);assert.equal(h.requests().length,before);
 await h.repo.query([{kinds:[1],limit:30}]);assert.equal(h.requests().length,before+1);
});
test('In-flight profile reads share the same batch with feed reactions; no per-post request leak',async t=>{
 const h=setup(t);await Promise.all([h.repo.profile(authors[0]),h.repo.profiles(authors),h.repo.decorate(data.pages[0],data.user)]);
 assert.equal(h.requests().length,1);assert.equal(h.requests()[0].message.length-2,2);assert.equal(h.repo.pending.size,0);
});
test('Already-running identity request is reused by a concurrent feed read',async t=>{
 const h=setup(t,{delay:80});const identity=h.repo.profile(authors[0]);
 await new Promise(r=>setTimeout(r,100));const decoration=h.repo.decorate([data.pages[0][0]],data.user);
 await Promise.all([identity,decoration]);assert.equal(h.requests().filter(r=>profileFilters(r).length).length,1);
});
test('Manual fresh read sees an updated profile; ordinary use keeps session metadata',async t=>{
 const h=setup(t);await h.repo.profile(authors[0]);h.events.push(data.updated);
 assert.notEqual((await h.repo.profile(authors[0])).name,'updated-on-second-relay');
 assert.equal((await h.repo.profile(authors[0],{fresh:true})).name,'updated-on-second-relay');assert.equal(h.requests().length,2);
});
test('Write preflight bypasses known profiles and refuses partial all-relay results',async t=>{
 const h=setup(t);await h.repo.profile(authors[0]);h.settings.value.relays.push(second);h.fail[second]='rate-limited: test';
 await assert.rejects(h.repo.replacement(0,authors[0],{fresh:true,all:true,required:true}),/全リレー/);
 assert.equal(h.requests().length,3);assert.ok(h.requests().some(r=>r.url===second));
});
test('Changing read-relay coverage invalidates known-profile reuse',async t=>{
 const h=setup(t);await h.repo.profile(authors[0]);h.settings.value.relays=[second];await h.repo.profile(authors[0]);
 assert.equal(h.requests().length,2);assert.equal(h.requests()[1].url,second);
});
test('Navigation keeps session profiles; a new repository/tab or logout does not',async t=>{
 const h=setup(t);await h.repo.profile(authors[0]);h.repo.beginView(data.user);await h.repo.profile(authors[0]);assert.equal(h.requests().length,1);
 h.repo.resetSession();await h.repo.profile(authors[0]);assert.equal(h.requests().length,2);
 const other=new Repository(h.storage,h.pool,h.settings);await other.profile(authors[0]);assert.equal(h.requests().length,3);
});
test('Null, invalid or incomplete profile responses never become known profiles',async t=>{
 const absent=setup(t,{events:[]});await absent.repo.profile(authors[0]);await absent.repo.profile(authors[0]);assert.equal(absent.requests().length,2);
 const h=setup(t);h.settings.value.relays=[relay,second];h.settings.value.readRelayCount=2;h.fail[second]='rate-limited: test';
 await h.repo.profile(authors[0]);const before=h.requests().length;await h.repo.profile(authors[0]);
 assert.equal(h.requests().length,before+1);assert.equal(h.repo.profileReads.size,0);
});
test('Missing-author repair is per-relay, preserves newer metadata on a capped second relay',async t=>{
 const h=setup(t,{perRelay:{[second]:[...data.profiles.slice(0,29),data.cappedUpdate]},caps:{[second]:5}});
 h.settings.value.relays=[relay,second];h.settings.value.readRelayCount=2;
 await h.repo.profiles(authors);
 assert.equal(h.repo.peekProfile(authors[29]).name,'newer-on-capped-relay');
 assert.equal(h.requests().filter(r=>r.url===relay).length,1);assert.equal(h.requests().filter(r=>r.url===second).length,3);
 const repair=h.requests().filter(r=>r.url===second).slice(1).flatMap(r=>r.message.slice(2));
 assert.equal(repair.length,25);assert.ok(repair.every(f=>f.limit===1&&f.authors.length===1));
 assert.ok(!repair.some(f=>f.authors[0]===authors[0]));
 assert.equal(authors.filter(k=>h.repo.profileReads.has(k)).length,30);
});
test('Historical versions cannot crowd out missing profiles permanently; recovery is bounded',async t=>{
 const older=data.profiles.slice(1,8).map(e=>e); // Old enough to be behind author 0 history on this relay.
 const h=setup(t,{events:[data.profiles[0],...data.history,...older],caps:{[relay]:5}});
 const keys=data.profiles.slice(0,8).map(e=>e.pubkey);await h.repo.profiles(keys);
 assert.equal(keys.filter(k=>h.repo.profileReads.has(k)).length,8);assert.ok(h.requests().length<=2);
});
test('Empty EOSE has no pointless repair; positive-partial EOSE checks absent authors at most once',async t=>{
 const empty=setup(t,{events:[]});await empty.repo.profiles(authors);assert.equal(empty.requests().length,1);
 const partial=setup(t,{events:[data.profiles[0]]});await partial.repo.profiles(authors);
 assert.equal(partial.requests().length,3);assert.equal(partial.repo.profileReads.size,1);
 const before=partial.requests().length;await partial.repo.profiles(authors);assert.equal(partial.requests().length,before+1);
});
test('Repair never repeats own reactions, known authors, or starts after failed EOSE',async t=>{
 const h=setup(t,{caps:{[relay]:f=>f.kinds[0]===0?5:60}});await h.repo.decorate(data.pages[0],data.user);
 assert.equal(h.requests().length,3);assert.equal(h.requests().filter(r=>kinds(r).includes(7)).length,1);
 const bad=setup(t,{fail:{[relay]:'rate-limited: test'}});const info=await bad.repo.decorate(data.pages[0],data.user);
 assert.equal(info.complete,false);assert.equal(bad.requests().length,1);assert.equal(bad.repo.profileReads.size,0);
});
test('The first repair rejection stops all further repair chunks on that relay',async t=>{
 let count=0;const h=setup(t,{caps:{[relay]:5},fail:{[relay]:()=>++count===2?'rate-limited: stop':null}});
 const result=await h.repo.decorate(data.pages[0],data.user);assert.equal(result.complete,false);assert.equal(h.requests().length,2);assert.equal(h.repo.profileReads.size,0);
});
test('A logout during a pending read cannot restore old session metadata',async t=>{
 const h=setup(t,{delay:80});const request=h.repo.profile(authors[0]);await new Promise(r=>setTimeout(r,90));h.repo.resetSession();await request;
 assert.equal(h.repo.profileReads.size,0);assert.equal(h.repo.replacements.size,0);
});
test('Session profile memory is bounded and does not evict the active account first',async t=>{
 const h=setup(t);h.repo.owner=authors[0];
 const profiles=Array.from({length:LIMITS.sessionProfiles+4},(_,i)=>({...data.profiles[0],pubkey:i===0?authors[0]:i.toString(16).padStart(64,'0')}));
 h.repo.rememberProfiles(profiles,[relay]);assert.equal(h.repo.profileReads.size,LIMITS.sessionProfiles);assert.ok(h.repo.profileReads.has(authors[0]));
});

test('Malformed latest metadata cannot become a successful reusable profile via an older valid version',async t=>{
 const h=setup(t,{events:[data.invalidProfile,data.profiles[1]]});
 await h.repo.profile(data.invalidProfile.pubkey);await h.repo.profile(data.invalidProfile.pubkey);
 assert.equal(h.requests().length,2);assert.equal(h.repo.profileReads.size,0);
 await h.repo.accept(data.profiles[1]);h.repo.rememberProfiles([data.profiles[1]],[relay]);
 assert.equal(h.repo.knownProfile(data.invalidProfile.pubkey,[relay]),null);
});
test('Profile batching respects the 100-author ceiling without changing ordinary filter limits',()=>{
 const list=Array.from({length:230},(_,i)=>({kinds:[0],authors:[i.toString(16).padStart(64,'0')],limit:1}));
 const filters=compactProfileFilters(list);assert.equal(filters.length,3);
 assert.equal(filters.reduce((n,f)=>n+f.authors.length,0),230);assert.ok(filters.every(f=>f.authors.length<=100&&f.limit===f.authors.length));
});
