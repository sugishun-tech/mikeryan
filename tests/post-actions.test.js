/** Render production components with a narrow DOM fixture, without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Posts } from '../js/ui/posts.js';
import { feedFilters } from '../js/feed/view.js';
import { settingsView } from '../js/settings/view.js';
import { DEFAULTS } from '../js/core/config.js';
import { installDOM } from './helpers/dom-fixture.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url),'utf8'));
const note=fixture.events.find(event=>event.id===fixture.root);
const reaction=fixture.events.find(event=>event.kind===7&&event.pubkey===fixture.keys.bob);

function setup(t) {
  const dom=installDOM(t);
  const app={
    session:{pubkey:fixture.keys.alice},settings:{value:{...DEFAULTS,loadImages:false}},
    repo:{events:new Map([[note.id,note]]),peekProfile:()=>({display_name:'Fixture author'})},
    identity:{mount:()=>{const node=dom.document.createElement('span');node.textContent='Fixture author';return node;}},
    router:{go:()=>{throw Error('Unexpected navigation');}}
  };
  app.posts=new Posts(app);t.after(()=>app.posts.reset());
  return {...dom,app};
}

test('Timeline, thread and embedded post actions offer no like or copy-link control',t=>{
  const dom=setup(t);
  for(const options of [{},{thread:true},{embedded:true,depth:1}]) {
    const card=dom.app.posts.render(note,options);dom.document.body.append(card);
    assert.equal(dom.findAll(card,node=>node.classList.contains('post-text')).length,1);
    const actions=dom.findAll(card,node=>node.classList.contains('post-actions'))[0];
    assert.ok(actions);
    assert.equal(dom.findAll(actions,node=>node.classList.contains('reply-action')).length,1);
    assert.deepEqual(dom.findAll(actions,node=>node.tagName==='BUTTON').map(node=>node.getAttribute('aria-label')),['Nostr投稿IDをコピー']);
    assert.equal(dom.findAll(card,node=>node.dataset.like||node.classList.contains('heart-action')).length,0);
  }
});

test('Received likes retain their notification label and link to the original post',t=>{
  const dom=setup(t),card=dom.app.posts.render(reaction,{notification:true});
  dom.document.body.append(card);
  const labels=dom.findAll(card,node=>node.classList.contains('notification-label'));
  assert.equal(labels.length,1);assert.ok(labels[0].textContent.includes('リアクション +'));
  assert.equal(dom.findAll(labels[0],node=>node.tagName==='SVG').length,1);
  assert.ok(dom.findAll(card,node=>node.tagName==='A').some(node=>node.getAttribute('href')===`#/thread/${note.id}`));
  assert.deepEqual(feedFilters(dom.app,'notifications'),[{kinds:[1,6,7,16],'#p':[fixture.keys.alice]}]);
});

test('Legacy pending likes have no resend row while ordinary pending posts remain available',async t=>{
  const dom=setup(t),host=dom.document.createElement('section');dom.document.body.append(host);
  const pending=event=>({event,time:Date.now(),results:[{relay:'wss://relay.example/',accepted:false,reason:'Pending fixture'}]});
  dom.app.storage={get:async()=>[pending(reaction),pending(note)]};
  dom.app.network={stats:async()=>({mode:'direct',coalesced:0,relays:[]})};
  await settingsView(dom.app,host);
  const rows=dom.findAll(host,node=>node.classList.contains('outbox-item'));
  assert.equal(rows.length,1);assert.ok(rows[0].textContent.includes('kind:1'));
  assert.equal(dom.findAll(rows[0],node=>node.tagName==='BUTTON'&&node.textContent==='未達リレーへ再送').length,1);
});
