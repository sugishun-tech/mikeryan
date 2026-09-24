#!/usr/bin/env node
/** Wire-byte benchmark against the unmodified 1.1.1 Repository/Pool.
 * Reload is a new Repository, ProfileCache and RelayPool with a disk-backed
 * string storage adapter. Not a claim of native browser IndexedDB persistence.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {Repository} from '../js/core/repository.js';
import {ProfileCache} from '../js/profiles/cache.js';
import {Nip05} from '../js/profiles/nip05.js';
import {RelayPool} from '../js/network/pool.js';
import {DEFAULTS,VERSION} from '../js/core/config.js';
import {fakeRelay} from '../tests/helpers/relay-fixture.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/traffic.json'),'utf8'));
const identities=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/events.json'),'utf8'));
const relays=['wss://benchmark-one.example/','wss://benchmark-two.example/'];
const settings={value:{...DEFAULTS,relays,readRelayCount:2,requestGapMs:0}};
const baseIndex=process.argv.indexOf('--baseline'),outputIndex=process.argv.indexOf('--output');
const output=outputIndex<0?path.join(root,'docs/persistence-traffic-results.json'):path.resolve(process.argv[outputIndex+1]);
function counters(h){const s=h.pool.stats().relays,sum=k=>s.reduce((n,x)=>n+x[k],0);return {
 requests:sum('requests'),closes:sum('closes'),sentJSONBytes:sum('sentBytes'),receivedJSONBytes:sum('receivedBytes'),receivedEvents:sum('events'),
 profileAuthorOccurrences:h.requests().flatMap(r=>r.message.slice(2)).filter(f=>f.kinds?.includes(0)).reduce((n,f)=>n+f.authors.length,0),
 filters:h.requests().reduce((n,r)=>n+r.message.length-2,0),connections:h.sockets.length};}
const delta=(a,b)=>Object.fromEntries(Object.keys(b).map(k=>[k,b[k]-a[k]]));
const total=rows=>Object.fromEntries(Object.keys(rows[0]).filter(k=>typeof rows[0][k]==='number').map(k=>[k,rows.reduce((n,r)=>n+r[k],0)]));
function disk(file){return {getItem:k=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file))[k]??null:null,setItem:(k,v)=>{const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};value[k]=v;fs.writeFileSync(file,JSON.stringify(value));}};}
async function run(version,Repo,Pool,{reload,anonymous}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mikeryan-bench-')),local=disk(path.join(directory,'profiles.json'));
 const steps=[];let h,repo;
 const boot=()=>{h=fakeRelay({events:[...fixture.profiles,...fixture.pages.flat(),...fixture.reactions],Pool});
  repo=new Repo(h.storage,h.pool,settings,{profileCache:new ProfileCache({indexedDB:null,localStorage:local})});};
 try{
  boot();
  for(let i=0;i<5;i++){
   if(i&&reload){await h.close();boot();}
   const before=counters(h),page=fixture.pages[0];
   const result=await repo.query([{kinds:[1],until:page[0].created_at,limit:30}]);
   const info=await repo.decorate(result.events,anonymous?null:fixture.user);
   assert.equal(result.events.length,30);assert.ok(page.every(e=>result.events.some(r=>r.id===e.id)));
   assert.ok(page.every(e=>repo.peekProfile(e.pubkey).name));assert.equal(info.complete,true);
   if(!anonymous)assert.equal(info.events.filter(e=>e.kind===7).length,30);
   steps.push({operation:i+1,...delta(before,counters(h))});
  }
  const sum=total(steps);delete sum.operation;
  assert.equal(sum.requests,sum.closes);
  const stored=fs.existsSync(path.join(directory,'profiles.json'))?Object.values(JSON.parse(fs.readFileSync(path.join(directory,'profiles.json')))).map(JSON.parse):[];
  assert.ok(stored.every(r=>r.event.kind===0));
  return {version,scenario:`${anonymous?'anonymous':'signed-in'}-${reload?'five-restarts':'one-session'}`,steps,total:sum,persistedProfileCount:stored.length};
 }finally{await h?.close();fs.rmSync(directory,{recursive:true,force:true});}
}
async function httpRun(version,Repo,isCurrent){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mikeryan-nip05-')),local=disk(path.join(dir,'profiles.json'));let http=0;
 const stages=[];
 try{
  for(let i=0;i<5;i++){
   const h=fakeRelay({events:identities.events});
   const verifier=new Nip05(null,{fetcher:async()=>{http++;return new Response(JSON.stringify({names:{alice:identities.keys.alice,bob:identities.keys.bob}}));}});
   const repo=new Repo(h.storage,h.pool,settings,{profileCache:new ProfileCache({indexedDB:null,localStorage:local}),verifier});
   const before=http;
   await repo.profile(identities.keys.bob);
   // In 1.1.1 identity rendering called Nip05.verify; in 1.2.0 the repository
   // verifies once during explicit acquisition, then rendering is read-only.
   if(!isCurrent)await verifier.verify('bob@example.com',identities.keys.bob);
   stages.push(http-before);await h.close();
  }
  return {version,checksPerRestart:stages,totalHTTP:http};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const versions=[];
if(baseIndex>=0){const base=path.resolve(process.argv[baseIndex+1]);const mod=await import(pathToFileURL(path.join(base,'js/core/repository.js'))),pool=await import(pathToFileURL(path.join(base,'js/network/pool.js')));
 versions.push({version:JSON.parse(fs.readFileSync(path.join(base,'package.json'))).version,Repo:mod.Repository,Pool:pool.RelayPool,current:false});}
versions.push({version:VERSION,Repo:Repository,Pool:RelayPool,current:true});
const scenarios=[],nip05=[];
for(const v of versions){for(const reload of [false,true])for(const anonymous of [false,true])scenarios.push(await run(v.version,v.Repo,v.Pool,{reload,anonymous}));nip05.push(await httpRun(v.version,v.Repo,v.current));}
const comparison=[];
if(versions.length===2)for(const scenario of [...new Set(scenarios.map(r=>r.scenario))]){
 const old=scenarios.find(r=>r.scenario===scenario&&r.version===versions[0].version),current=scenarios.find(r=>r.scenario===scenario&&r.version===VERSION);
 const reduction=Object.fromEntries(Object.keys(old.total).map(k=>[k,old.total[k]?Number(((1-current.total[k]/old.total[k])*100).toFixed(2)):0]));
 comparison.push({scenario,old:old.total,current:current.total,reductionPercent:reduction});
}
const result={conditions:{baseline:'Unmodified uploaded mikeryan 1.1.1, not original mynostr.',protocol:'Production Repository, RelayPool, RelayConnection and BIP-340 verification; simulated JSON WebSocket relay.',data:'Same signed fixture of 30 posts by 30 authors; two relays; own 30 likes for signed-in scenario; five explicit identical reads.',restart:'New Repository, ProfileCache and RelayPool, same disk-backed string storage. No real native IndexedDB/browser restart is claimed.',excluded:'Bootstrap/contact/mute reads, static files, images, HTTP response bytes, WebSocket framing, TCP/TLS, relay CPU/I/O, latency, upload costs. NIP-05 HTTP count is a separate 1-identity fixture.',limits:'Complete conforming metadata on both relays. Boundary searches or missing/capped relay results can require more requests.'},scenarios,comparison,nip05};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.table(comparison.map(r=>({scenario:r.scenario,oldREQ:r.old.requests,newREQ:r.current.requests,oldSent:r.old.sentJSONBytes,newSent:r.current.sentJSONBytes,oldReceived:r.old.receivedJSONBytes,newReceived:r.current.receivedJSONBytes,receivedReduction:r.reductionPercent.receivedJSONBytes})));
console.log('NIP05:',nip05);console.log('Result:',output);
