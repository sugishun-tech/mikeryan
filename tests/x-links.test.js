import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webReference, contentPlan, contentLinks, linkHref, imageMetadata } from '../js/content/references.js';
const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const fixture=JSON.parse(read('tests/fixtures/rich-content.json'));
const make=(content,tags=[])=>({kind:1,content,tags});
const x='https://x.com/example/status/1234567890123456789';
for (const host of ['x.com','www.x.com','mobile.x.com','twitter.com','www.twitter.com','mobile.twitter.com']) {
  test(`X/Twitter ${host} embeds within the existing depth limit and keeps its link`,()=>{
    const url=`https://${host}/example/status/1234567890123456789?s=20#reply`;
    const expected={type:'x',id:'1234567890123456789',href:url,raw:url};
    assert.deepEqual(webReference(url),expected);
    assert.deepEqual(contentPlan(make(url)).embed,expected);
    assert.deepEqual(contentPlan(make(url),{depth:1}).embed,expected);
    for (const depth of [2,3,100]) assert.equal(contentPlan(make(url),{depth}).embed,null);
    assert.equal(linkHref(url),url);
  });
}
for (const suffix of ['', '/', '/photo/1', '/video/1', '/photo/4?s=20', '?s=20&t=tracking']) {
  test(`X share suffix ${suffix||'(none)'} selects the same post ID`,()=>{
    const url=x+suffix;
    assert.equal(webReference(url).id,'1234567890123456789');
    assert.equal(contentPlan(make(url)).embed.type,'x');
    assert.equal(linkHref(url),url);
  });
}
test('HTTP and username-free X post URLs select the same string ID',()=>{
  for (const url of ['http://twitter.com/a/status/123','https://x.com/i/web/status/123','https://x.com/i/status/123']) {
    assert.deepEqual(webReference(url),{type:'x',id:'123',href:url,raw:url});
    assert.equal(linkHref(url),url);
  }
});
for (const url of ['https://x.com/home','https://x.com/a/status/123/unrecognized','https://x.com:9000/a/status/123','https://x.com/a/status/not-an-id','https://x.com/a/status/0','https://x.com/a/status/123456789012345678901']) {
  test(`X URL stays link-only: ${url}`,()=>{
    assert.equal(contentPlan(make(url)).embed,null);
    assert.equal(linkHref(url),url);
  });
}
test('Multiple and duplicate X URLs consume only the first rich slot and retain all links',()=>{
  const urls=[x,'https://twitter.com/example/status/9876543210987654321',x];
  const event=make(urls.join(' '));
  assert.deepEqual(contentPlan(event).embed,webReference(x));
  assert.deepEqual([...contentLinks(event.content)].map(t=>linkHref(t.raw)),urls);
});
for (const [url,type] of [
  ['https://media.example/photo.png','image'],
  ['https://youtu.be/M7lc1UVf-VE','youtube'],
  [fixture.uris.note,'nostr'],[fixture.uris.npub,'nostr'],[fixture.uris.naddr,'nostr']
]) {
  test(`X and ${type} share the first-candidate slot: ${url}`,()=>{
    const event=make(`${x} https://twitter.com/example/status/123 ${url}`);
    assert.deepEqual(contentPlan(event).embed,webReference(x));
    assert.equal(contentPlan(make(`${url} ${x}`)).embed.type,type);
    assert.equal(contentPlan(event,{depth:2}).embed,null);
    assert.equal([...contentLinks(event.content)].length,3);
  });
}
test('A body X post consumes the slot before q-only quotes while retaining their links',()=>{
  const event=make(x,[['q',fixture.events.original.id]]);
  const plan=contentPlan(event);
  assert.deepEqual(plan.embed,webReference(x));
  assert.equal(plan.quotes[0].id,fixture.events.original.id);
  assert.equal(plan.quotes.length,1);
});
test('Image settings skip images, not X, under the same first-candidate policy',()=>{
  const event=make(`${x} https://media.example/photo.png https://youtu.be/M7lc1UVf-VE ${fixture.uris.note}`);
  assert.equal(contentPlan(event).embed.type,'x');
  assert.equal(contentPlan(event,{images:false}).embed.type,'x');
  const imageFirst=make(`https://media.example/photo.png ${x} https://youtu.be/M7lc1UVf-VE`);
  assert.equal(contentPlan(imageFirst).embed.type,'image');
  assert.equal(contentPlan(imageFirst,{images:false}).embed.type,'x');
  assert.equal(contentPlan(event,{depth:2}).embed,null);
});
test('imeta cannot turn an X/Twitter page URL into an image request',()=>{
  for (const [url,type] of [[x,'x'],['https://twitter.com/example/status/123','x'],['https://x.com/example/photo.png',undefined]]) {
    const event=make(url,[['imeta','url '+url,'m image/png']]);
    assert.equal(webReference(url,imageMetadata(event))?.type,type);
    assert.equal(contentPlan(event).embed?.type,type);
    assert.equal(linkHref(url),url);
  }
});
test('Direct X-hosted media is still a normal image, including NIP-92 metadata',()=>{
  assert.equal(webReference('https://pbs.twimg.com/media/sample.jpg').type,'image');
  const url='https://pbs.twimg.com/media/sample?format=jpg&name=large';
  const event=make(url,[['imeta','url '+url,'m image/jpeg','dim 640x480']]);
  const embed=contentPlan(event).embed;
  assert.equal(embed.type,'image');assert.equal(embed.href,url);assert.equal(embed.width,640);
});
test('X uses an official cross-origin frame without widgets in the account document',()=>{
  for (const path of ['assets/embeds/x.html','assets/embeds/x.css','js/content/x-frame.js']) assert.equal(fs.existsSync(new URL(path,root)),false,path);
  for (const path of ['index.html','js/ui/embeds.js']) assert.doesNotMatch(read(path),/https:\/\/platform\.(?:x|twitter)\.com\/widgets\.js/);
  assert.ok(read('js/ui/embeds.js').includes('https://platform.twitter.com'));
  assert.ok(read('index.html').includes("script-src 'self';"));
  assert.ok(read('index.html').includes('frame-src https://www.youtube-nocookie.com https://platform.twitter.com;'));
});
test('Entry and all shipped module import versions match the release',()=>{
  const version=JSON.parse(read('package.json')).version;
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(new URL(d.name+'/',dir)):new URL(d.name,dir));
  for (const url of [new URL('index.html',root),...walk(new URL('js/',root)).filter(u=>u.pathname.endsWith('.js'))]) {
    for (const ref of fs.readFileSync(url,'utf8').matchAll(/[?&]v=(\d+\.\d+\.\d+)/g)) assert.equal(ref[1],version,url.pathname);
  }
});
