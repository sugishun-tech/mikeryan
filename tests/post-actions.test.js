/** Render production components with a narrow DOM fixture, without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Posts } from '../js/ui/posts.js';
import { feedFilters } from '../js/feed/view.js';
import { settingsView } from '../js/settings/view.js';
import { DEFAULTS } from '../js/core/config.js';
import { Emitter, isHex } from '../js/core/utils.js';
import { installDOM } from './helpers/dom-fixture.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/events.json',import.meta.url),'utf8'));
const note=fixture.events.find(event=>event.id===fixture.root);
const reaction=fixture.events.find(event=>event.kind===7&&event.pubkey===fixture.keys.bob);

function setup(t,{withReplies=false}={}) {
  const dom=installDOM(t);
  const app={
    session:{pubkey:fixture.keys.alice},settings:{value:{...DEFAULTS,loadImages:false}},
    repo:{events:new Map([[note.id,note]]),peekProfile:()=>({display_name:'Fixture author'})},
    identity:{mount:()=>{const node=dom.document.createElement('span');node.textContent='Fixture author';return node;}},
    router:{go:()=>{throw Error('Unexpected navigation');}}
  };
  if(withReplies){
    const replies=new Emitter();replies.states=new Map();replies.calls=[];
    replies.eligible=event=>event.kind===7&&event.pubkey!==app.session.pubkey&&
      event.tags.filter(tag=>tag[0]==='p').at(-1)?.[1]===app.session.pubkey&&
      isHex(event.tags.filter(tag=>tag[0]==='e').at(-1)?.[1]);
    replies.state=event=>replies.states.get(event.id)??{status:'idle'};
    replies.change=(event,status)=>{replies.states.set(event.id,{status});replies.emit('change',{targetId:event.id,pubkey:app.session.pubkey,status});};
    replies.like=async event=>{replies.calls.push(event);replies.change(event,'liked');};
    app.social={reactionReplies:replies};
  }
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

test('Only incoming top-level reaction notifications have an actionable heart',t=>{
  const dom=setup(t,{withReplies:true}),replies=dom.app.social.reactionReplies;
  const findHearts=card=>dom.findAll(card,node=>node.tagName==='BUTTON'&&node.classList.contains('heart-action'));
  for(const content of ['+','','👍',':custom:']){
    const event={...reaction,content},card=dom.app.posts.render(event,{notification:true});dom.document.body.append(card);
    const [heart]=findHearts(card);assert.ok(heart);assert.equal(heart.dataset.reactionId,event.id);
    assert.equal(heart.getAttribute('aria-pressed'),'false');assert.equal(heart.disabled,false);
  }
  for(const options of [{},{thread:true,notification:true},{embedded:true,notification:true},{depth:1,notification:true}]){
    assert.equal(findHearts(dom.app.posts.render(reaction,options)).length,0);
  }
  const others=[note,{...reaction,kind:1},{...reaction,kind:6},{...reaction,kind:16},
    {...reaction,pubkey:fixture.keys.alice},
    {...reaction,tags:[...reaction.tags,['p',fixture.keys.bob]]},
    {...reaction,tags:reaction.tags.filter(tag=>tag[0]!=='e')}];
  for(const event of others)assert.equal(findHearts(dom.app.posts.render(event,{notification:true})).length,0);
  assert.equal(replies.calls.length,0);
});

test('Reaction heart submits its reaction once, then remains pressed and disabled',async t=>{
  const dom=setup(t,{withReplies:true}),replies=dom.app.social.reactionReplies;
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  replies.like=async event=>{replies.calls.push(event);await pending;replies.change(event,'liked');};
  const card=dom.app.posts.render(reaction,{notification:true});dom.document.body.append(card);
  const [heart]=dom.findAll(card,node=>node.classList.contains('heart-action'));
  heart.click();heart.click();
  assert.equal(replies.calls.length,1);assert.equal(replies.calls[0].id,reaction.id);
  assert.equal(heart.disabled,true);assert.equal(heart.getAttribute('aria-busy'),'true');
  finish();await dom.flush();
  assert.equal(heart.classList.contains('liked'),true);assert.equal(heart.getAttribute('aria-pressed'),'true');
  assert.equal(heart.disabled,true);assert.equal(heart.getAttribute('aria-busy'),null);
  heart.click();await dom.flush();assert.equal(replies.calls.length,1);
});

test('Reaction state updates affect the matching mounted heart without publishing',t=>{
  const dom=setup(t,{withReplies:true}),replies=dom.app.social.reactionReplies;
  const other={...reaction,id:'a'.repeat(64)};
  const mount=event=>{const card=dom.app.posts.render(event,{notification:true});dom.document.body.append(card);return dom.findAll(card,node=>node.classList.contains('heart-action'))[0];};
  const first=mount(reaction),second=mount(other);
  replies.change(reaction,'pending');
  assert.equal(first.disabled,true);assert.equal(first.classList.contains('is-pending'),true);
  assert.equal(first.getAttribute('aria-pressed'),'false');assert.ok(first.getAttribute('title').includes('未完了の送信'));
  assert.equal(second.disabled,false);
  replies.change(reaction,'liked');
  assert.equal(first.classList.contains('liked'),true);assert.equal(first.classList.contains('is-pending'),false);
  assert.equal(second.classList.contains('liked'),false);assert.equal(replies.calls.length,0);
});

test('Reaction controls cannot act after the account changes, and reset releases the subscription',async t=>{
  const dom=setup(t,{withReplies:true}),replies=dom.app.social.reactionReplies;
  for(let i=0;i<3;i++)dom.document.body.append(dom.app.posts.render({...reaction,id:String(i).repeat(64)},{notification:true}));
  const [heart]=dom.findAll(dom.document.body,node=>node.classList.contains('heart-action'));
  assert.equal(replies.listeners.get('change').size,1);
  dom.app.session.pubkey=fixture.keys.bob;heart.click();await dom.flush();assert.equal(replies.calls.length,0);
  dom.app.posts.reset();assert.equal(replies.listeners.get('change').size,0);
  assert.equal(dom.app.posts.reactionButtons.size,0);
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

test('Settings retry uses only the dedicated authored reaction ledger',async t=>{
  const dom=setup(t,{withReplies:true}),host=dom.document.createElement('section');dom.document.body.append(host);
  dom.document.getElementById=()=>null;
  t.mock.method(globalThis,'setTimeout',callback=>{callback();return 0;});
  const event={...reaction,pubkey:fixture.keys.alice,content:'+',tags:[['e',reaction.id],['p',reaction.pubkey],['k','7']]};
  const pending={event,time:Date.now(),results:[{relay:'wss://relay.example/',accepted:false,reason:'Pending fixture'}]};
  const retried=[],rendered=[];
  dom.app.storage={get:async()=>[{...pending,event:reaction}]};
  dom.app.network={stats:async()=>({mode:'direct',coalesced:0,relays:[]})};
  dom.app.social.reactionReplies.pendingRows=async()=>[pending];
  dom.app.social.reactionReplies.retry=async value=>retried.push(value);
  dom.app.social.retry=()=>{throw Error('Generic reaction retry must remain blocked');};
  dom.app.render=async route=>rendered.push(route);
  await settingsView(dom.app,host);
  const rows=dom.findAll(host,node=>node.classList.contains('outbox-item'));
  assert.equal(rows.length,1);assert.ok(rows[0].textContent.includes('リアクションへのいいね'));
  const [retry]=dom.findAll(rows[0],node=>node.tagName==='BUTTON'&&node.textContent==='未達リレーへ再送');
  retry.click();await dom.flush();
  assert.deepEqual(retried,[event]);assert.equal(rendered.length,1);
});
