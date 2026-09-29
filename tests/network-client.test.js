import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkClient } from '../js/network/client.js';
function fakeWorker(t){
 const previous=globalThis.SharedWorker,workers=[];
 class Worker{
  constructor(){workers.push(this);this.sent=[];this.port={start(){},close:()=>{this.closed=true;},postMessage:message=>{if(this.throwSend)throw Error('message transport closed');this.sent.push(message);if(message.method==='hello')queueMicrotask(()=>this.port.onmessage?.({data:{id:message.id,result:{ok:true}}}));}};}
 }
 globalThis.SharedWorker=Worker;t.after(()=>{if(previous===undefined)delete globalThis.SharedWorker;else globalThis.SharedWorker=previous;});
 return workers;
}
async function harness(t){
 const workers=fakeWorker(t),client=new NetworkClient();await client.ready;
 t.after(()=>{for(const p of client.pending.values()){clearTimeout(p.timer);p.reject(Error('test cleanup'));}client.pending.clear();client.worker?.port.close();client.localPool?.close();});
 return {client,worker:workers[0]};
}
test('Worker RPC synchronous send failure removes its pending request and timer',async t=>{
 const {client,worker}=await harness(t);worker.throwSend=true;await assert.rejects(client.rpc('query',{},50),/transport|通信/);assert.equal(client.pending.size,0);
});
test('Worker crash rejects in-flight requests immediately without replaying a send',async t=>{
 const {client,worker}=await harness(t);let rejected=false;const job=client.rpc('publish',{event:'test'},100).catch(()=>{rejected=true;});
 worker.onerror?.({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(rejected,true);await job;
 assert.equal(client.worker,null);assert.equal(client.mode,'per-tab');assert.equal(worker.sent.filter(m=>m.method==='publish').length,1);assert.equal(client.localPool.connections.size,0);
});
test('Worker deserialization error rejects all pending requests and enables manual fallback',async t=>{
 const {client,worker}=await harness(t);const jobs=[client.rpc('query',{},100),client.rpc('stats',{},100)];jobs.forEach(p=>p.catch(()=>{}));
 worker.port.onmessageerror?.({});assert.equal(client.pending.size,0);assert.equal(client.mode,'per-tab');assert.equal((await Promise.allSettled(jobs)).every(r=>r.status==='rejected'),true);
 let calls=0;client.localPool.query=async()=>{calls++;return {events:[],complete:true,errors:[]};};await client.query({});assert.equal(calls,1);
});
test('Malformed worker messages cannot throw an uncaught handler exception',async t=>{
 const {worker}=await harness(t);assert.doesNotThrow(()=>worker.port.onmessage({data:null}));assert.doesNotThrow(()=>worker.port.onmessage({data:'invalid'}));
});
test('A late old-worker response cannot resolve a failed request or revive a dead worker',async t=>{
 const {client,worker}=await harness(t);const job=client.rpc('query',{},100);job.catch(()=>{});const id=worker.sent.at(-1).id;
 worker.onerror?.({preventDefault(){}});worker.port.onmessage?.({data:{id,result:{events:['stale']}}});await assert.rejects(job);assert.equal(client.worker,null);
});
test('Unavailable SharedWorker falls back without opening unsolicited relay sockets',async t=>{
 const previous=globalThis.SharedWorker;globalThis.SharedWorker=undefined;t.after(()=>{if(previous===undefined)delete globalThis.SharedWorker;else globalThis.SharedWorker=previous;});
 const client=new NetworkClient();await client.ready;assert.equal(client.mode,'per-tab');assert.equal(client.localPool.connections.size,0);client.localPool.close();
});
