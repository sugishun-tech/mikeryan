import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../js/core/router.js';
function historyFixture(t){
 const old={window:globalThis.window,location:globalThis.location,history:globalThis.history};
 const listeners=[],entries=[{hash:'#/global',state:{otherAppField:1}}];let index=0;
 const apply=()=>listeners.forEach(fn=>fn());
 globalThis.window={addEventListener:(type,fn)=>{if(type==='hashchange')listeners.push(fn);}};
 globalThis.location={search:'',get hash(){return entries[index].hash;},set hash(hash){if(hash===entries[index].hash)return;entries.splice(index+1);entries.push({hash,state:structuredClone(entries[index].state)});index++;apply();}};
 globalThis.history={get state(){return entries[index].state;},replaceState(state){entries[index].state=structuredClone(state);},back(){if(index){index--;apply();}},forward(){if(index+1<entries.length){index++;apply();}}};
 t.after(()=>{for(const key of Object.keys(old)){if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}});
 return {clearListeners:()=>{listeners.length=0;},entries};
}
test('Back follows anchor-created routes, not only Router.go calls',async t=>{
 historyFixture(t);const router=new Router(()=>{});await router.start();location.hash='#/home';location.hash='#/settings';router.back();assert.equal(location.hash,'#/home');router.back();assert.equal(location.hash,'#/global');
});
test('Native back then forward then header back retains accurate history',async t=>{
 historyFixture(t);const router=new Router(()=>{});await router.start();router.go('#/home');router.go('#/settings');history.back();history.forward();router.back();assert.equal(location.hash,'#/home');
});
test('Reloading a route retains the within-app back target and foreign state',async t=>{
 const fixture=historyFixture(t);const first=new Router(()=>{});await first.start();location.hash='#/home';location.hash='#/settings';fixture.clearListeners();const next=new Router(()=>{});await next.start();next.back();assert.equal(location.hash,'#/home');assert.equal(history.state.otherAppField,1);
});
test('New navigation after native back discards forward entries without a wrong back depth',async t=>{
 historyFixture(t);const router=new Router(()=>{});await router.start();router.go('#/home');router.go('#/settings');history.back();location.hash='#/notifications';router.back();assert.equal(location.hash,'#/home');history.forward();assert.equal(location.hash,'#/notifications');
});
test('Opening a deep link directly does not navigate back out of the app',async t=>{
 historyFixture(t);location.hash='#/settings';const router=new Router(()=>{});await router.start();router.back();assert.equal(location.hash,'#/global');
});
