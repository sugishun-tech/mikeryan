import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Embeds } from '../js/ui/embeds.js';
import { contentPlan } from '../js/content/references.js';
import { installDOM } from './helpers/dom-fixture.js';

const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/rich-content.json',import.meta.url),'utf8')).events;

function setup(t) {
  const dom=installDOM(t,{onSource(element,url){
    if(element.tagName==='IMG')queueMicrotask(()=>element.dispatchEvent(new Event('load')));
    else if(element.tagName==='IFRAME') {
      const origin=new URL(url).origin;
      if(origin==='https://www.youtube-nocookie.com') {
        element.contentWindow.postMessage=raw=>{
          if(JSON.parse(raw).event==='listening')queueMicrotask(()=>dom.message(element.contentWindow,origin,{event:'onReady'}));
        };
        queueMicrotask(()=>element.dispatchEvent(new Event('load')));
      } else if(origin==='https://platform.twitter.com')queueMicrotask(()=>{
        for(const [method,params]of [['twttr.private.resize',[{height:350}]],['twttr.private.rendered',[]]])
          dom.message(element.contentWindow,origin,{'twttr.embed':{jsonrpc:'2.0',method,params}});
      });
    }
  }});
  const embeds=new Embeds({repo:{}},()=>{throw Error('Unexpected Nostr lookup');},{timeout:500});
  t.after(()=>embeds.reset());
  const mount=name=>{
    const post=dom.document.createElement('article');post.dataset.eventId=fixtures[name].id;
    const host=embeds.mount(contentPlan(fixtures[name]).embed);post.append(host);dom.document.body.append(post);
    return host;
  };
  return {...dom,embeds,mount};
}

for(const [type,names,tag]of [
  ['image',['image','images'],'IMG'],
  ['YouTube',['youtube','youtubeWatch'],'IFRAME'],
  ['X',['x','twitter','xMultiple'],'IFRAME']
])test(`Same ${type} media remains visible in every distinct post`,async t=>{
  const dom=setup(t),hosts=names.map(dom.mount);
  assert.equal(new Set(names.map(name=>fixtures[name].id)).size,names.length);
  dom.visible();await dom.flush();
  for(const host of hosts){
    assert.equal(host.dataset.state,'ready');
    assert.equal(dom.findAll(host,node=>node.tagName===tag).length,1);
  }
  assert.equal(dom.sources.length,names.length);
  // A later post is also rendered while the earlier identical media stays mounted.
  const later=dom.mount(names[0]);dom.visible();await dom.flush();
  assert.equal(later.dataset.state,'ready');
  assert.equal(dom.findAll(later,node=>node.tagName===tag).length,1);
});

test('Closing a repeated player leaves the other post ready and mounted',async t=>{
  const dom=setup(t),first=dom.mount('youtube'),second=dom.mount('youtubeWatch');
  dom.visible();await dom.flush();
  dom.findAll(first,node=>node.tagName==='BUTTON')[0].click();
  assert.equal(first.dataset.state,'failed');
  assert.equal(dom.findAll(first,node=>node.tagName==='IFRAME').length,0);
  assert.equal(second.dataset.state,'ready');
  assert.equal(dom.findAll(second,node=>node.tagName==='IFRAME').length,1);
  assert.equal(dom.embeds.jobs.size,1);
});
