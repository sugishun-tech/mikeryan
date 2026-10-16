import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_NAME, storagePrefix } from '../js/core/config.js';
import { contentPlan, CONTENT_LIMITS, contentLinks, linkHref } from '../js/content/references.js';
const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const fixture=JSON.parse(read('tests/fixtures/rich-content.json'));
const events=fixture.events;

test('Application display name changes without renaming stored data',()=>{
  assert.equal(APP_NAME,'マイク・ライアン');
  assert.ok(storagePrefix().startsWith('mikeryan:v1:'));
  const entry=read('index.html');
  assert.ok(entry.includes('<title>マイク・ライアン</title>'));
  assert.ok(entry.includes('<span>マイク・ライアン</span>'));
  assert.ok(entry.includes('id="page-title">マイク・ライアン</h1>'));
  assert.doesNotMatch(read('js/app.js'),/\/ mikeryan|\?\?'mikeryan'/);
});
test('Right search is deleted with its handlers; mobile search is preserved',()=>{
  const entry=read('index.html'), app=read('js/app.js');
  assert.doesNotMatch(entry,/id="(?:search-form|search-input|search-button)"/);
  assert.doesNotMatch(app,/getElementById\('(?:search-form|search-input|search-button)'\)/);
  assert.ok(entry.includes('id="mobile-search-button"'));
  assert.ok(app.includes("addEventListener('click',()=>this.searchDialog())"));
});
test('Maximum embed depth is two and not a per-post width setting',()=>assert.equal(CONTENT_LIMITS.maxDepth,2));
for (const name of ['ref_note','ref_nevent','ref_npub','ref_nprofile','ref_naddr','image','imeta','images','youtubeMultiple','quote','quoteAddress','repostJSON','generic','genericNested','mixed','mixedNostrFirst']) {
  test(`${name}: depths zero and one select the same sole candidate; two and above stop`,()=>{
    const expected=contentPlan(events[name]).embed;
    assert.ok(expected);
    assert.deepEqual(contentPlan(events[name],{depth:1}).embed,expected);
    for(const depth of [2,3,100]) assert.equal(contentPlan(events[name],{depth}).embed,null);
  });
}
for (const name of ['multiple','images','youtubeMultiple','mixed','mixedNostrFirst']) {
  test(`${name}: added depth never consumes additional sibling links`,()=>{
    const first=contentPlan(events[name],{depth:0}).embed;
    assert.deepEqual(contentPlan(events[name],{depth:1}).embed,first);
    assert.equal(Array.isArray(first),false);
    const links=[...contentLinks(events[name].content)];
    assert.ok(links.length>=2);
    assert.ok(links.every(t=>linkHref(t.raw)));
  });
}
test('Invalid first Nostr URI and disabled images remain enforced at depth one',()=>{
  assert.equal(contentPlan(events.invalidFirst,{depth:1}).embed,null);
  assert.equal(contentPlan(events.images,{depth:1,images:false}).embed,null);
});
