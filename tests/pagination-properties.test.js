/** Deterministic generated datasets; the relay transport is covered separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventPager } from '../js/feed/pagination.js';
import { sortEvents, matchesFilter, compareEvents } from '../js/core/utils.js';
function data(seed){
 let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 const authors=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)];
 return sortEvents(Array.from({length:80+Math.floor(random()*220)},(_,i)=>({id:(i+1).toString(16).padStart(64,'0'),pubkey:authors[Math.floor(random()*3)],kind:1,tags:[],content:String(i),created_at:1000-Math.floor(random()*25)})));
}
function pagerFor(events){
 const filters=['a','b','c'].map(a=>({kinds:[1],authors:[a.repeat(64)]}));
 return new EventPager(async filters=>({events:sortEvents(filters.flatMap(f=>events.filter(e=>matchesFilter(e,f)).slice(0,f.limit))),complete:true,errors:[]}),filters);
}
test('100 seeded duplicate-time, multi-author datasets page downward without gaps or duplicates',async()=>{
 for(let seed=1;seed<=100;seed++){
  const events=data(seed),pager=pagerFor(events);let page=await pager.load('latest',null,1000),seen=new Set(page.map(e=>e.id));
  for(let click=0;click<100&&!pager.exhausted;click++){
   page=await pager.older();assert.ok(page.length<=30,`seed ${seed}: page bound`);
   for(const event of page){assert.ok(!seen.has(event.id),`seed ${seed}: duplicate`);seen.add(event.id);}
  }
  assert.equal(pager.exhausted,true,`seed ${seed}: termination`);assert.deepEqual(sortEvents([...pager.events.values()]).map(e=>e.id),events.map(e=>e.id),`seed ${seed}: completeness`);
 }
});
test('100 seeded upward searches return nearest neighbors, not the newest remote page',async()=>{
 for(let seed=1;seed<=100;seed++){
  const events=data(seed),pager=pagerFor(events),anchor=events[Math.floor(events.length*.7)];pager.events.set(anchor.id,anchor);let page=[];
  for(let click=0;click<100&&!page.length;click++)page=await pager.load('newer',anchor,1000);
  const expected=events.filter(e=>compareEvents(e,anchor)<0);assert.ok(page.length>0&&page.length<=30,`seed ${seed}: nonempty bounded page`);
  assert.deepEqual(page.map(e=>e.id),expected.slice(-page.length).map(e=>e.id),`seed ${seed}: nearest neighbors`);
 }
});
