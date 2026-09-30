import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeKey, encodeAddress } from '../js/core/nip19.js';
import { parentId, matchesFilter } from '../js/core/utils.js';
import { parseRoute, routeHash } from '../js/core/router.js';
import { contentLinks, nostrReference, coordinateReference, contentPlan, webReference, imageMetadata, linkHref, referenceHref, referenceKey, quoteReferences, CONTENT_LIMITS } from '../js/content/references.js';
import { ContentResolver } from '../js/content/resolver.js';
import { Repository } from '../js/core/repository.js';
import { feedFilters } from '../js/feed/view.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixtures/rich-content.json',import.meta.url))), e=f.events;
const make=(content,tags=[])=>({kind:1,content,tags});
const result=events=>({events,complete:true,errors:[]});
function repoFixture({missing=false,fail=false}={}) {
  const calls=[];
  const repo={generation:0,events:new Map(),readRelays:()=>['wss://configured.example/'],knownProfile:key=>missing?null:e.bobProfile,
    profile:async key=>{calls.push(['profile',key]);if(fail)throw Error('offline');return {};},
    event:async id=>{calls.push(['event',id]);await new Promise(r=>setTimeout(r,1));if(fail)throw Error('offline');return missing?null:Object.values(e).find(v=>v.id===id);},
    address:async ref=>{calls.push(['address',ref]);return missing?null:e.article;},
    accept:async event=>{repo.events.set(event.id,event);calls.push(['accept',event.id]);}};
  return {repo,calls,resolver:new ContentResolver(repo)};
}
for(const [name,type] of [['note','event'],['nevent','event'],['npub','profile'],['nprofile','profile'],['naddr','address']]) {
  test(`NIP-21 ${name}: decoding, winner, clickable route`,()=>{
    const ref=nostrReference(f.uris[name]);assert.equal(ref.type,type);
    assert.equal(contentPlan(e['ref_'+name]).embed.reference.type,type);
    assert.match(linkHref(f.uris[name]),/^#\/(profile|thread|address)\//);
    assert.equal(nostrReference(f.uris[name].toUpperCase()).type,type);
  });
  test(`NIP-21 ${name}: depth 1 cannot start another rich reference`,()=>assert.equal(contentPlan(e['ref_'+name],{depth:1}).embed,null));
  test(`NIP-21 ${name}: retrieval failure is contained and coalesced`,async()=>{
    const {resolver,calls}=repoFixture({missing:true});const ref=nostrReference(f.uris[name]);
    assert.deepEqual(await Promise.all([resolver.resolve(ref),resolver.resolve(ref)]),[null,null]);assert.equal(calls.length,1);
  });
}
test('NIP-19 naddr coordinate includes UTF-8 identifier, pubkey, kind and is reversible',()=>{
  const decoded=decodeKey(f.uris.naddr);assert.equal(decoded.data.kind,30023);assert.equal(decoded.data.pubkey,f.keys.bob);assert.equal(decoded.data.identifier,'article:日本語');
  assert.equal(encodeAddress(decoded.data),f.uris.naddr.slice(6));
});
test('NIP-19 nevent retains optional author/kind/relay hints',()=>{
  const d=decodeKey(f.uris.nevent);assert.equal(d.author,f.keys.bob);assert.equal(d.kind,1);assert.deepEqual(d.relays,['wss://unconfigured.example']);
});
test('naddr local routes survive parse and reconstruction',()=>{
  const reference=nostrReference(f.uris.naddr),href=referenceHref(reference),route=parseRoute(href);
  assert.equal(route.view,'address');assert.equal(route.reference.identifier,'article:日本語');assert.equal(routeHash(route),href);
  assert.equal(parseRoute('#/address/%broken').view,'global');
});
test('Invalid checksum, secrets, overlong and mixed-case NIP-21 never become embeds',()=>{
  for(const uri of [f.invalid,'nostr:nsec1private','nostr:note1'+'q'.repeat(6000),f.uris.note.replace('note','Note')])assert.equal(nostrReference(uri),null);
  assert.equal(linkHref('nostr:nsec1private'),'');assert.equal(contentPlan(e.invalidFirst).embed,null);assert.equal(linkHref(f.invalid),f.invalid);
});
test('First NIP-21 only; all later links preserved by lexer',()=>{
  assert.equal(contentPlan(e.multiple).embed.reference.id,e.original.id);assert.equal([...contentLinks(e.multiple.content)].length,3);
});
test('Lexer removes sentence punctuation without breaking balanced URL paths or losing offsets',()=>{
  const text='(https://example.com/a_(b).png), '+f.uris.note+'。';const links=[...contentLinks(text)];
  assert.equal(links[0].raw,'https://example.com/a_(b).png');assert.equal(text.slice(links[0].index,links[0].end),links[0].raw);assert.equal(links[1].raw,f.uris.note);
  assert.equal([...contentLinks(null)].length,0);
});
test('First body candidate wins across Nostr, image, X, YouTube and q',()=>{
  assert.equal(contentPlan(e.mixed).embed.type,'image');assert.equal(contentPlan(e.mixedNostrFirst).embed.type,'nostr');
  assert.equal(contentPlan(e.mixed).quotes.length,1);assert.equal(contentPlan(e.mixed,{depth:1}).embed,null);
});
for(const extension of ['jpg','JPEG','png','webp','gif','avif','apng','bmp'])test(`Direct image ${extension}: query safe, HTTPS only, depth and settings limits`,()=>{
  const url=`https://media.example/a.${extension}?v=1`;
  assert.equal(webReference(url).type,'image');assert.equal(webReference(url.replace('https:','http:')),null);
  assert.equal(contentPlan(make(url),{images:false}).embed,null);assert.equal(contentPlan(make(url),{depth:1}).embed,null);
});
test('NIP-92 m/dim/alt allow extensionless images without arbitrary imeta-only loading',()=>{
  const plan=contentPlan(e.imeta);assert.equal(plan.embed.type,'image');assert.equal(plan.embed.width,3000);assert.equal(plan.embed.height,1000);assert.equal(plan.embed.alt,'青空の写真');
  assert.equal(contentPlan(make('no URLs',e.imeta.tags)).embed,null);
  assert.equal(imageMetadata(make('',[['imeta','url javascript:alert(1)','m image/png']])).size,0);
});
test('Multiple image links select exactly the first',()=>assert.equal(contentPlan(e.images).embed.href,'https://media.example/photo.JPG?size=1000'));
for(const name of ['youtube','youtubeWatch','youtubeShorts','youtubeMultiple'])test(`YouTube ${name}: one valid ID, no nested player`,()=>{
  const embed=contentPlan(e[name]).embed;assert.equal(embed.type,'youtube');assert.equal(embed.id,'M7lc1UVf-VE');assert.equal(contentPlan(e[name],{depth:1}).embed,null);
});
for(const name of ['x','twitter','xMultiple'])test(`X ${name}: first status and no nested card`,()=>{
  assert.equal(contentPlan(e[name]).embed.id,'1234567890123456789');assert.equal(contentPlan(e[name],{depth:1}).embed,null);
});
for(const url of ['https://youtube.com.evil.example/watch?v=M7lc1UVf-VE','https://youtu.be/a','https://youtube.com/watch?v=M7lc1UVf-VE.bad','https://x.com/a/status/1/trailing','https://x.com.evil.example/a/status/123','https://evil.example/video.mp4','javascript:alert(1)','data:image/png;base64,xxx','https://u:p@x.com/a/status/1','https://x.com:444/a/status/123','https://x.com/home'])test(`No arbitrary iframe or unsafe URL: ${url}`,()=>assert.equal(webReference(url),null));
test('q-only references are quotes and not legacy replies',()=>{
  assert.equal(parentId(e.quote),null);assert.equal(parentId(e.quoteReply),e.deep.id);assert.equal(quoteReferences(e.quote).length,1);
  assert.equal(contentPlan(e.quote).embed.reference.id,e.original.id);assert.equal(contentPlan(e.quoteAddress).embed.reference.identifier,'article:日本語');
  assert.equal(coordinateReference('1:'+f.keys.bob+':x'),null);
});
test('Reposts have no reply parent and their original consumes the sole slot',()=>{
  for(const name of ['repostJSON','repostEmpty','generic','genericEmpty','genericNested']){
    assert.equal(parentId(e[name]),null);assert.equal(contentPlan(e[name]).embed.type,'repost');assert.equal(contentPlan(e[name],{depth:1}).embed,null);
  }
});
for(const name of ['repostJSON','generic','genericNested'])test(`Repost ${name}: verifies and uses JSON without event fetch`,async()=>{
  const {resolver,calls}=repoFixture();const value=await resolver.repost(e[name]);assert.ok(value);assert.equal(calls.filter(c=>c[0]==='event'||c[0]==='address').length,0);
});
for(const name of ['repostEmpty','repostMalformed','repostForged','genericEmpty'])test(`Repost ${name}: safely fetches its exact tagged original`,async()=>{
  const {resolver,calls}=repoFixture();const value=await resolver.repost(e[name]);assert.ok(value);assert.notEqual(value.content,'偽造された内容');assert.equal(calls.length,1);
});
test('Forged embedded JSON is not trusted even when wrapper was signed',async()=>{
  const {resolver}=repoFixture({missing:true});assert.equal(await resolver.repost(e.repostForged),null);
});
test('Repost missing and network-failure cases resolve to null, never reject',async()=>{
  for(const fail of [true,false]){const {resolver}=repoFixture({missing:!fail,fail});assert.equal(await resolver.repost(e.repostMissing),null);}
});
test('NIP-18 inner event ID/kind constraints reject mismatching content',async()=>{
  const {resolver}=repoFixture({missing:true});
  assert.equal(await resolver.repost({...e.repostJSON,id:'a'.repeat(64),tags:[['e',e.deep.id]]}),null);
  assert.equal(await resolver.repost({...e.generic,id:'b'.repeat(64),tags:[['k','1']]}),null);
});
test('Self-repost returns null without recursive resolution',async()=>{
  const {resolver,repo}=repoFixture();const root={...e.generic,id:'a'.repeat(64),content:'',tags:[['e','a'.repeat(64)]]};repo.events.set(root.id,root);assert.equal(await resolver.repost(root),null);
});
test('NIP-21 duplicates and note/nevent aliases share a single fetch',async()=>{
  const {resolver,calls}=repoFixture();const result=await Promise.all([resolver.resolve(nostrReference(f.uris.note)),resolver.resolve(nostrReference(f.uris.nevent))]);
  assert.ok(result.every(x=>x?.id===e.original.id));assert.equal(calls.length,1);
});
test('nevent constraints are applied per caller even after a shared ID fetch',async()=>{
  const {resolver,calls}=repoFixture();const ref=nostrReference(f.uris.note);
  const values=await Promise.all([resolver.resolve({...ref,kind:30023}),resolver.resolve(ref)]);
  assert.equal(values[0],null);assert.equal(values[1].id,e.original.id);assert.equal(calls.length,1);
});
test('Current-view events are reused, never fetched twice from relay',async()=>{
  const {resolver,repo,calls}=repoFixture();repo.events.set(e.original.id,e.original);assert.equal((await resolver.resolve(nostrReference(f.uris.note))).id,e.original.id);assert.equal(calls.length,0);
});
test('View changes invalidate settled and late results; relay hints do not add connections',async()=>{
  const {resolver,repo,calls}=repoFixture();const ref=nostrReference(f.uris.nevent);
  const promise=resolver.resolve(ref);repo.generation++;assert.equal(await promise,null);
  assert.equal((await resolver.resolve(ref)).id,e.original.id);assert.equal(calls.length,2);assert.deepEqual(repo.readRelays(),['wss://configured.example/']);
});
test('Single-flight memo is bounded and explicit read reset allows retry',async()=>{
  const {resolver}=repoFixture({missing:true});for(let i=0;i<CONTENT_LIMITS.memo+10;i++)await resolver.resolve({type:'event',id:i.toString(16).padStart(64,'0')});
  assert.equal(resolver.memo.size,CONTENT_LIMITS.memo);resolver.reset();assert.equal(resolver.memo.size,0);
});
test('Address fetch sends exact kind/author/d filter and selects newest matching version',async()=>{
  const calls=[],settings={value:{relays:['wss://configured.example/'],readRelayCount:1,requestGapMs:800}};
  const network={query:async payload=>{calls.push(payload);return result([e.oldArticle,e.article,e.otherArticle]);}};
  const repo=new Repository(null,network,settings),reference=nostrReference(f.uris.naddr);
  const values=await Promise.all([repo.address(reference),repo.address(reference)]);
  assert.ok(values.every(x=>x.id===e.article.id));assert.equal(calls.length,1);
  assert.deepEqual(calls[0].filters,[{authors:[f.keys.bob],kinds:[30023],'#d':['article:日本語'],limit:1}]);
  assert.equal(repo.events.has(e.article.id),true);
});
test('Global, home and notifications include repost kinds in actual feed filters',()=>{
  const app={session:{pubkey:f.keys.alice},social:{following:new Set([f.keys.bob])}};
  for(const view of ['global','home','notifications']){const filter=feedFilters(app,view)[0];assert.ok(filter.kinds.includes(6));assert.ok(filter.kinds.includes(16));}
});
