import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Storage} from '../js/core/storage.js';
import {RelayConnection,cooldownFor} from '../js/network/relay.js';
import {RelayPool} from '../js/network/pool.js';
import {matchesFilter,sleep,sortEvents} from '../js/core/utils.js';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url)));
const note=data.events.find(e=>e.kind===1);
function harness(t,{events=[note],mode='normal',delay=0}={}){
 const messages=[],sockets=[],clients=[];
 class Socket{
  constructor(url){this.url=url;this.readyState=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
  emit(m){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(m)});}
  send(text){const m=JSON.parse(text);messages.push({url:this.url,message:m});if(m[0]==='REQ')setTimeout(()=>{
   if(mode==='timeout')return;
   if(mode==='limited'){this.emit(['CLOSED',m[1],'rate-limited: slow down']);return;}
   const all=mode==='malformed'?[{...note,id:'x'}, {...note,id:'1'.repeat(64)},...events]:events;
   for(const e of all)if(mode==='malformed'||m.slice(2).some(f=>matchesFilter(e,f)))this.emit(['EVENT',m[1],e]);
   this.emit(['EOSE',m[1]]);
  },this.url.includes('slow')?25:delay);
  if(m[0]==='EVENT')queueMicrotask(()=>this.emit(['OK',m[1].id,mode!=='rejected',mode==='rejected'?'blocked: no writes':'']));
  }
  close(){this.readyState=3;this.onclose?.();}
 }
 const options={gap:0,timeout:40,socketFactory:url=>new Socket(url)};
 const storage=new Storage();
 t.after(async()=>{await sleep(1);for(const c of clients)c.close();});
 return {messages,sockets,storage,connection:(url='wss://example.com/')=>{const c=new RelayConnection(url,storage,options);clients.push(c);return c;},pool:()=>{const p=new RelayPool(storage,options);clients.push(p);return p;}};
}
test('One relay connection, finite REQ/CLOSE per page and verified deduplication',async t=>{
 const h=harness(t,{events:[note,note]}),c=h.connection();
 assert.equal((await c.query([{kinds:[1],limit:10}])).length,1);
 await c.query([{kinds:[1],limit:10}]);
 assert.equal(h.sockets.length,1);assert.equal(c.stats.requests,2);assert.equal(c.stats.closes,2);
 assert.equal(c.pending.size,0);
});
test('Bad event IDs and signatures are discarded before UI/cache',async t=>{
 const h=harness(t,{mode:'malformed'}),c=h.connection();const found=await c.query([{kinds:[1],limit:10}]);
 assert.deepEqual(found,[note]);assert.equal(c.stats.invalid,2);
});
test('Rate limit creates durable cooldown without reconnects or blind retry',async t=>{
 const h=harness(t,{mode:'limited'}),c=h.connection();
 await assert.rejects(c.query([{kinds:[1],limit:10}]),/rate-limited/);
 await assert.rejects(c.query([{kinds:[1],limit:10}]),/休止/);
 assert.equal(h.messages.filter(m=>m.message[0]==='REQ').length,1);
 const second=h.connection();await assert.rejects(second.query([{kinds:[1],limit:10}]),/休止/);assert.equal(h.sockets.length,1);
 assert.ok((await h.storage.get('health:wss://example.com/')).until>Date.now());
});
test('Timeout always sends CLOSE and is not a successful empty result',async t=>{
 const h=harness(t,{mode:'timeout'}),p=h.pool();const r=await p.query({relays:['wss://example.com'],filters:[{kinds:[1],limit:10}],gap:0});
 assert.equal(r.complete,false);assert.equal(r.events.length,0);assert.equal(r.errors.length,1);assert.equal(h.messages.filter(x=>x.message[0]==='CLOSE').length,1);
 const r2=await p.query({relays:['wss://example.com'],filters:[{kinds:[1],limit:10}],gap:0});assert.equal(r2.cached,false);assert.equal(r2.complete,false);
});
test('Identical in-flight and completed queries are reused across consumers',async t=>{
 const h=harness(t),p=h.pool(),query={relays:['wss://example.com'],filters:[{kinds:[1],limit:10}],gap:0};
 const [a,b]=await Promise.all([p.query(query),p.query(query)]);assert.deepEqual(a.events,b.events);
 const cached=await p.query(query);assert.equal(cached.cached,true);assert.equal(p.coalesced,1);assert.equal(p.queryHits,1);assert.equal(h.messages.filter(m=>m.message[0]==='REQ').length,1);
 const [stillCached,fresh]=await Promise.all([p.query(query),p.query({...query,fresh:true})]);assert.equal(stillCached.cached,true);assert.equal(fresh.cached,false);assert.equal(h.messages.filter(m=>m.message[0]==='REQ').length,2);
});
test('Fast EOSE does not truncate slower relay completion',async t=>{
 const h=harness(t),p=h.pool();const result=await p.query({relays:['wss://fast.example.com','wss://slow.example.com'],filters:[{kinds:[1],limit:10}],gap:0});
 assert.equal(result.complete,true);assert.equal(result.events.length,1);assert.equal(h.sockets.length,2);assert.equal(h.messages.filter(m=>m.message[0]==='CLOSE').length,2);
});
test('Successful publication ACK is reused without a second EVENT',async t=>{
 const h=harness(t),p=h.pool(),args={relays:['wss://example.com'],event:note,gap:0};
 assert.equal((await p.publish(args)).accepted,1);assert.equal((await p.publish(args)).accepted,1);
 assert.equal(h.messages.filter(m=>m.message[0]==='EVENT').length,1);
 await assert.rejects(p.publish({...args,event:{...note,content:'tampered'}}),/署名/);
});
test('Relay rejected publish remains failure, does not report saved',async t=>{
 const h=harness(t,{mode:'rejected'}),p=h.pool();const r=await p.publish({relays:['wss://example.com'],event:note,gap:0});assert.equal(r.accepted,0);assert.match(r.results[0].reason,/blocked/);
});
test('Backoff is exponential, rate limits longer than generic errors',()=>{
 assert.equal(cooldownFor('rate-limited: test',1,()=>0),60000);assert.equal(cooldownFor('rate-limited: test',3,()=>0),240000);assert.equal(cooldownFor('blocked: test',1,()=>0),3600000);assert.equal(cooldownFor('error: test',1,()=>0),5000);
});
test('Filter limits and unsafe relay addresses are rejected without connection',async t=>{
 const h=harness(t),p=h.pool();for(const args of [{relays:['https://example.com'],filters:[{limit:1}]},{relays:['wss://example.com'],filters:[{limit:1000000}]},{relays:['wss://example.com'],filters:[{authors:[],limit:1}]}])await assert.rejects(p.query(args));assert.equal(h.sockets.length,0);
});
