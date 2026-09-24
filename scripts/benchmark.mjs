/** Count actual JSON frames through production Repository -> Pool -> Connection
 * against an in-process relay with signed, deterministic public test events.
 * node scripts/benchmark.mjs [--baseline /path/to/unpacked/mikeryan-1.1.0]
 * This is not a measurement of a public relay's CPU, latency, TCP/TLS or HTTP.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Repository} from '../js/core/repository.js';
import {RelayPool} from '../js/network/pool.js';
import {DEFAULTS, VERSION} from '../js/core/config.js';
import {fakeRelay} from '../tests/helpers/relay-fixture.js';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/traffic.json'),'utf8'));
const relays=['wss://benchmark-one.example/','wss://benchmark-two.example/'];
const output=process.argv.includes('--output')?process.argv[process.argv.indexOf('--output')+1]:path.join(root,'docs/traffic-results.json');
function snapshot(h) {
 const snapshots=h.pool.stats().relays;
 const sum=key=>snapshots.reduce((n,s)=>n+s[key],0);
 return {requests:sum('requests'),closes:sum('closes'),receivedEvents:sum('events'),sentJSONBytes:sum('sentBytes'),receivedJSONBytes:sum('receivedBytes'),
   profileAuthorOccurrences:h.requests().flatMap(r=>r.message.slice(2)).filter(f=>f.kinds?.includes(0)).reduce((n,f)=>n+f.authors.length,0),
   filters:h.requests().reduce((n,r)=>n+r.message.length-2,0)};
}
function delta(a,b){return Object.fromEntries(Object.keys(b).map(k=>[k,b[k]-a[k]]));}
async function measure(version,Repo=Repository,Pool=RelayPool,anonymous=false){
 const h=fakeRelay({events:[...fixture.profiles,...fixture.pages.flat(),...fixture.reactions],Pool});
 const settings={value:{...DEFAULTS,relays,readRelayCount:2,requestGapMs:0}};
 const repo=new Repo(h.storage,h.pool,settings), steps=[];
 async function step(name,page,key){
  const from=h.requests().length,before=snapshot(h);
  const result=await repo.query([{kinds:[1],until:page[0].created_at,limit:30}]);
  const info=await repo.decorate(result.events,key);
  assert.equal(result.events.length,30);assert.equal(info.complete,true);
  assert.ok(page.every(e=>result.events.some(r=>r.id===e.id)));
  assert.ok(page.every(e=>repo.peekProfile(e.pubkey).name));
  if(key)assert.equal(new Set(info.events.filter(e=>e.kind===7).flatMap(e=>e.tags.filter(t=>t[0]==='e').map(t=>t[1]))).size,30);
  steps.push({name,...delta(before,snapshot(h)),requestsPerRelay:relays.map(relay=>({relay,count:h.requests().slice(from).filter(r=>r.url===relay).length})),
    profileAuthorsPerRelay:relays.map(relay=>({relay,count:h.requests().slice(from).filter(r=>r.url===relay).flatMap(r=>r.message.slice(2)).filter(f=>f.kinds?.includes(0)).reduce((n,f)=>n+f.authors.length,0)}))});
 }
 try{
  if(anonymous){
   await step('anonymous cold: 30 unknown authors',fixture.pages[0],null);
   await step('anonymous next: same 30 authors',fixture.pages[1],null);
  }else{
   await step('cold: 30 unknown authors, signed in',fixture.pages[0],fixture.user);
   await step('next: same 30 authors, different posts, signed in',fixture.pages[1],fixture.user);
   await step('mixed: 20 known + 10 unknown authors, signed in',fixture.pages[2],fixture.user);
   repo.beginView(fixture.user);
   await step('return: same 30 authors, signed in',fixture.pages[0],fixture.user);
   await step('repeat: same 30 authors, still signed in',fixture.pages[1],fixture.user);
  }
  assert.equal(h.storage.memory.size,0);
  return {version,relayCount:relays.length,steps,total:snapshot(h),connections:h.sockets.length};
 }finally{await h.close();}
}
const runs=[],anonymousRuns=[];
const baseIndex=process.argv.indexOf('--baseline');
if(baseIndex>=0){
 const base=path.resolve(process.argv[baseIndex+1]);
 const {Repository:BaseRepo}=await import(pathToFileURL(path.join(base,'js/core/repository.js')));
 const {RelayPool:BasePool}=await import(pathToFileURL(path.join(base,'js/network/pool.js')));
 const version=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8')).version;
 runs.push(await measure(version,BaseRepo,BasePool));
 anonymousRuns.push(await measure(version,BaseRepo,BasePool,true));
}
runs.push(await measure(VERSION));
anonymousRuns.push(await measure(VERSION,Repository,RelayPool,true));
const result={conditions:{fixture:'tests/fixtures/traffic.json; public signed TEST data',signatureVerification:'Production BIP-340/id verification enabled',transport:'In-process WebSocket fixture using production RelayConnection; newest-first, bounded per-filter results',operations:'Five signed-in post/decorate reads, no logout; two selected relays; 30 posts per read; one own positive reaction per post. Independent anonymous sessions are measured separately.',excluded:'Account bootstrap, NIP-05 HTTP, images, TCP/TLS framing/handshakes, server CPU/I/O/latency and public-relay variation. Upward range probes and missing-profile repairs are separate tests.',note:'Metadata is complete on both fixture relays; this is not a universal request-count bound or a benchmark against original mynostr.'},runs,anonymousRuns};
if(runs.length===2){
 result.reduction={};for(const key of ['requests','sentJSONBytes','receivedJSONBytes','receivedEvents','filters'])result.reduction[key]=Number(((1-runs[1].total[key]/runs[0].total[key])*100).toFixed(2));
}
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
for(const run of runs){console.log('\n'+run.version);console.table(run.steps.map(s=>({operation:s.name,REQ:s.requests,filters:s.filters,profileAuthors:s.profileAuthorOccurrences,events:s.receivedEvents,sentBytes:s.sentJSONBytes,receivedBytes:s.receivedJSONBytes})));}
if(result.reduction)console.log('Reduction (%):',result.reduction);
console.log('Result:',output);
