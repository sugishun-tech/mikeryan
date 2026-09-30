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
  test(`X/Twitter ${host} remains an unchanged ordinary link`,()=>{
    const url=`https://${host}/example/status/1234567890123456789?s=20#reply`;
    assert.equal(webReference(url),null);
    assert.equal(contentPlan(make(url)).embed,null);
    assert.equal(contentPlan(make(url),{depth:1}).embed,null);
    assert.equal(linkHref(url),url);
  });
}
for (const suffix of ['', '/', '/photo/1', '/video/1', '/photo/4?s=20', '?s=20&t=tracking']) {
  test(`X share suffix ${suffix||'(none)'} never creates an embed`,()=>{
    const url=x+suffix;
    assert.equal(webReference(url),null);
    assert.equal(contentPlan(make(url)).embed,null);
    assert.equal(linkHref(url),url);
  });
}
for (const url of ['http://twitter.com/a/status/123','https://x.com/i/web/status/123','https://x.com/home','https://x.com/a/status/123/unrecognized','https://x.com:9000/a/status/123']) {
  test(`X URL stays link-only: ${url}`,()=>{
    assert.equal(contentPlan(make(url)).embed,null);
    assert.equal(linkHref(url),url);
  });
}
test('Multiple and duplicate X URLs all remain links without consuming a rich slot',()=>{
  const urls=[x,'https://twitter.com/example/status/1234567890123456789',x];
  const event=make(urls.join(' '));
  assert.equal(contentPlan(event).embed,null);
  assert.deepEqual([...contentLinks(event.content)].map(t=>linkHref(t.raw)),urls);
});
for (const [url,type] of [
  ['https://media.example/photo.png','image'],
  ['https://youtu.be/M7lc1UVf-VE','youtube'],
  [fixture.uris.note,'nostr'],[fixture.uris.npub,'nostr'],[fixture.uris.naddr,'nostr']
]) {
  test(`Leading X links leave the slot available for ${url}`,()=>{
    const event=make(`${x} https://twitter.com/example/status/123 ${url}`);
    assert.equal(contentPlan(event).embed.type,type);
    assert.equal(contentPlan(event,{depth:1}).embed,null);
    assert.equal([...contentLinks(event.content)].length,3);
  });
}
test('X links do not suppress q-only quote references',()=>{
  const event=make(x,[['q',fixture.events.original.id]]);
  const plan=contentPlan(event);
  assert.equal(plan.embed.type,'nostr');assert.equal(plan.embed.reference.id,fixture.events.original.id);
  assert.equal(plan.quotes.length,1);
});
test('Image settings and first-candidate policy are unchanged with an X prefix',()=>{
  const event=make(`${x} https://media.example/photo.png https://youtu.be/M7lc1UVf-VE ${fixture.uris.note}`);
  assert.equal(contentPlan(event).embed.type,'image');
  assert.equal(contentPlan(event,{images:false}).embed.type,'youtube');
  assert.equal(contentPlan(event,{depth:1}).embed,null);
});
test('imeta cannot turn an X/Twitter page URL into an image request',()=>{
  for (const url of [x,'https://twitter.com/example/status/123','https://x.com/example/photo.png']) {
    const event=make(url,[['imeta','url '+url,'m image/png']]);
    assert.equal(webReference(url,imageMetadata(event)),null);
    assert.equal(contentPlan(event).embed,null);
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
test('X widget, frame and diagnostic assets are absent',()=>{
  for (const path of ['assets/embeds/x.html','assets/embeds/x.css','js/content/x-frame.js','js/content/x-diagnostics.js','docs/x-embed-check.html','docs/x-embed-check.css']) assert.equal(fs.existsSync(new URL(path,root)),false,path);
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(new URL(d.name+'/',dir)):new URL(d.name,dir));
  for (const file of [...walk(new URL('js/',root)),...walk(new URL('assets/',root))].filter(u=>/\.(?:js|css|html)$/.test(u.pathname))) {
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/widgets\.js|createTweet|twttr|mikeryan-x-embed|x-player|x-frame\.js|assets\/embeds\/x\.html/,file.pathname);
  }
  assert.ok(read('index.html').includes("script-src 'self';"));
  assert.ok(read('index.html').includes('frame-src https://www.youtube-nocookie.com;'));
  assert.ok(!read('index.html').includes("frame-src 'self'"));
});
test('Entry and all shipped module import versions match the release',()=>{
  const version=JSON.parse(read('package.json')).version;
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(new URL(d.name+'/',dir)):new URL(d.name,dir));
  for (const url of [new URL('index.html',root),...walk(new URL('js/',root)).filter(u=>u.pathname.endsWith('.js'))]) {
    for (const ref of fs.readFileSync(url,'utf8').matchAll(/[?&]v=(\d+\.\d+\.\d+)/g)) assert.equal(ref[1],version,url.pathname);
  }
});
