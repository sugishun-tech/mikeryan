import test from 'node:test';
import assert from 'node:assert/strict';
import {EventPager} from '../js/feed/pagination.js';
import {sortEvents,matchesFilter} from '../js/core/utils.js';
import {validateSettings} from '../js/settings/store.js';
import {DEFAULTS,LIMITS} from '../js/core/config.js';
const event=(id,time,author='a'.repeat(64))=>({id:id.toString(16).padStart(64,'0'),kind:1,pubkey:author,created_at:time,tags:[],content:`post ${id}`});
function setup(events,filters=[{kinds:[1]}]){
 const calls=[];
 const pager=new EventPager(async fs=>{calls.push(fs);return {complete:true,errors:[],events:sortEvents(fs.flatMap(f=>sortEvents(events.filter(e=>matchesFilter(e,f))).slice(0,f.limit))) };},filters);
 return {pager,calls};
}
test('Latest means now-down, at most 30 combined unique rows, replacing the old window',async()=>{
 const events=Array.from({length:100},(_,i)=>event(i+1,200-i));events.push(event(501,999));const {pager,calls}=setup(events);
 pager.events.set('old',event(400,1));const page=await pager.load('latest',null,200);
 assert.equal(page.length,30);assert.equal(page[0].created_at,200);assert.equal(pager.events.size,30);assert.equal(calls.length,1);assert.equal(calls[0][0].until,200);assert.equal(calls[0][0].limit,30);
 await pager.load('latest',null,200);assert.equal(calls.length,2);
});
test('Down reads below the supplied viewport anchor, not the oldest loaded row',async()=>{
 const events=Array.from({length:120},(_,i)=>event(i+1,200-i));const {pager,calls}=setup(events);
 for(const e of events)pager.events.set(e.id,e);
 const page=await pager.load('older',events[40],200);
 assert.equal(calls[0][0].until,160);assert.equal(page.length,30);assert.equal(page[0].created_at,159);assert.equal(page.at(-1).created_at,130);
});
test('Up finds the nearest newer rows instead of jumping to the newest 30',async()=>{
 const events=Array.from({length:1000},(_,i)=>event(i+1,2000-i));const {pager,calls}=setup(events);
 const anchor=events[500];pager.events.set(anchor.id,anchor);let page=[];
 for(let click=0;click<8&&!page.length;click++)page=await pager.load('newer',anchor,2000);
 assert.ok(page.length>0&&page.length<=30);
 assert.equal(page.at(-1).created_at,1501);
 assert.deepEqual(page.map(e=>e.created_at),Array.from({length:page.length},(_,i)=>1500+page.length-i));
 assert.ok(calls.every(fs=>fs[0].since>=anchor.created_at&&fs[0].until<=2000));
});
test('At most six bounded time searches per upward click, with a resumable cursor only',async()=>{
 const events=[event(1,1),event(2,900000)];const {pager,calls}=setup(events);
 await pager.load('newer',events[0],1000000);assert.ok(calls.length<=LIMITS.upwardQueries);
 assert.ok(calls.every(fs=>Number.isInteger(fs[0].limit)&&fs[0].limit<=LIMITS.maxPageLimit));
 assert.equal(pager.events.size,0);assert.ok(pager.search);assert.equal('events' in pager.search,false);
 const page=await pager.load('newer',events[0],1000000);assert.deepEqual(page,[events[1]]);
});
test('Same-second down boundaries are inclusive and do not blindly subtract a second',async()=>{
 const events=sortEvents([...Array.from({length:95},(_,i)=>event(i+1,100)),event(200,99)]);const {pager}=setup(events);
 await pager.load('latest',null,100);
 for(let i=0;i<8&&!pager.exhausted;i++){const page=await pager.older();assert.ok(page.length<=30);}
 assert.equal(pager.events.size,96);assert.equal(pager.exhausted,true);
});
test('Same-second upward page is the nearest lexicographic predecessors',async()=>{
 const events=Array.from({length:100},(_,i)=>event(i+1,100));const {pager}=setup(events);
 const page=await pager.load('newer',events[70],100);
 assert.equal(page.length,30);assert.equal(page[0].id,events[40].id);assert.equal(page.at(-1).id,events[69].id);
});
test('A failed latest read preserves the current timeline and a failed up does not jump',async()=>{
 const anchor=event(5,5);const pager=new EventPager(async()=>({events:[],complete:false,errors:[{reason:'offline'}]}),[{kinds:[1]}]);pager.events.set(anchor.id,anchor);
 assert.equal((await pager.load('latest',null,100)).length,0);assert.equal(pager.events.size,1);
 await pager.load('newer',anchor,100);assert.equal(pager.events.size,1);assert.match(pager.warning,/進めていません/);
});
test('Repeated rapid clicks share one operation only, not a completed result',async()=>{
 let calls=0,finish;const pager=new EventPager(()=>{calls++;return new Promise(r=>{finish=r;});},[{kinds:[1]}]);
 const a=pager.load('latest',null,100),b=pager.load('older',event(1,50),100);assert.equal(a,b);assert.equal(calls,1);
 finish({events:[],complete:true,errors:[]});await a;assert.equal(pager.busy,null);
 const c=pager.load('latest',null,100);assert.equal(calls,2);finish({events:[],complete:true,errors:[]});await c;
});
test('Multiple author filters still add at most thirty total posts',async()=>{
 const authors=['a'.repeat(64),'b'.repeat(64)];const events=Array.from({length:80},(_,i)=>event(i+1,200-i,authors[i%2]));
 const {pager}=setup(events,authors.map(p=>({kinds:[1],authors:[p]})));assert.equal((await pager.load('latest',null,200)).length,30);
});
test('Old saved page sizes cannot expand the thirty-row limit',()=>{
 for(const batchSize of [10,200,100000])assert.equal(validateSettings({...DEFAULTS,batchSize}).batchSize,30);
});
