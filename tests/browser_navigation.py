"""Native ES-module browser regression with mock relay/storage/hash-navigation/SHA adapters.
No live account, extension, relay, IndexedDB or SharedWorker is exercised.
Run: python tests/browser_navigation.py
"""
import asyncio, base64, hashlib, json, os, shutil, time
from pathlib import Path
from playwright.async_api import async_playwright
from browser_offline import html, MOCK
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/output'; OUT.mkdir(exist_ok=True)
LOADER=r"""async ({sources,avatar})=>{
 const urls=new Map(),base='https://offline.example/mikeryan/';
 function load(file){
  if(urls.has(file))return urls.get(file);
  let source=sources[file];if(source===undefined)throw Error('Missing module '+file);
  source=source.replace(/import\.meta\.url/g,JSON.stringify(base+file));
  source=source.replace(/\blocation\./g,'window.__testLocation.').replace(/\bhistory\.back\(/g,'window.__testHistory.back(');
  if(file==='js/core/config.js')source=source.replace(/^export const FALLBACK_ICON = .*;$/m,'export const FALLBACK_ICON = '+JSON.stringify(avatar)+';');
  if(file==='js/app.js')source=source.replace('const app=new App();','const app=new App();window.__app=app;');
  source=source.replace(/(from\s+)(['"])(\.[^'"]+)\2/g,(_,prefix,quote,relative)=>prefix+JSON.stringify(load(new URL(relative,base+file).pathname.slice('/mikeryan/'.length))));
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.set(file,url);return url;
 }
 await import(load('js/app.js'));
}"""
async def main():
 checks=[]; errors=[]; data=fixtures()
 def ok(name,value=True):
  if not value:raise AssertionError(name)
  checks.append(name);print('PASS:',name,flush=True)
 settings=dict(relays=['ws://127.0.0.1:9876/'],readRelayCount=1,requestGapMs=800,batchSize=200,muteContentPatterns=[],muteDisplayNamePatterns=[],mutedPubkeys=[],hideIncompleteProfiles=False,loadImages=False,verifyNip05=True,theme='light')
 sources={p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'js').rglob('*.js')}
 avatar='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/avatar.svg').read_bytes()).decode()
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000},locale='ja-JP')
  context.set_default_timeout(12000)
  await context.expose_function('testGetKey',lambda:data['keys']['alice'])
  await context.expose_function('testSign',sign)
  await context.expose_function('testDigest',lambda a:list(hashlib.sha256(bytes(a)).digest()))
  page=await context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/*',lambda route:route.abort())
  await page.set_content(html())
  await page.evaluate(MOCK,dict(data=data,settings=settings,saved={}))
  await page.evaluate("""()=>{
    window.fetch=window.__testFetch;
    Object.defineProperty(window,'SharedWorker',{value:undefined,configurable:true});
    Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(alg,bytes)=>Uint8Array.from(await window.testDigest(Array.from(new Uint8Array(bytes)))).buffer}},configurable:true});
  }""")
  await page.evaluate(LOADER,dict(sources=sources,avatar=avatar))
  async def idle():
   await page.wait_for_function('window.__app?.activeFeed && !window.__app.activeFeed.operation && document.querySelectorAll(".timeline>.post").length>0')
  async def messages():return await page.evaluate('window.__messages.filter(m=>m[0]==="REQ")')
  await idle()
  ok('Native module app starts with exactly thirty posts despite legacy batchSize=200',await page.locator('.timeline>.post').count()==30)
  ok('Only the three requested read buttons appear',await page.locator('.feed-toolbar button').all_text_contents()==['下に読み込む','上に読み込む','最新を読み込む'])
  body=await page.locator('body').inner_text()
  ok('No network card or obsolete timeline controls',await page.locator('#network-summary').count()==0 and not any(word in body for word in ['いいね同期','新着を確認','さらに読み込む']))
  ok('Cold anonymous timeline uses posts plus one batched metadata query',len(await messages())==2)
  await page.evaluate('scrollTo(0,1800)');await page.wait_for_timeout(200)
  before=len(await messages());await page.wait_for_timeout(1000)
  ok('Scrolling alone sends no relay REQ',len(await messages())==before)
  rect=await page.locator('.feed-toolbar').bounding_box()
  ok('Desktop controls remain below the sticky header while scrolled',abs(rect['y']-56)<2)
  anchor=await page.evaluate('window.__app.activeFeed.current("older")')
  last=await page.evaluate('[...window.__app.activeFeed.pager.events.values()].sort((a,b)=>b.created_at-a.created_at).at(-1)')
  ok('Current lower anchor is inside the viewport, not the oldest loaded post',anchor['id']!=last['id'])
  before=len(await messages());count=await page.locator('.timeline>.post').count()
  await page.get_by_role('button',name='下に読み込む',exact=True).click();await idle()
  sent=(await messages())[before:]
  ok('Down sends until at the actual viewport anchor',sent[0][2]['until']==anchor['created_at'])
  ok('Down adds no more than thirty rows',0<=await page.locator('.timeline>.post').count()-count<=30)
  before=len(await messages());await page.get_by_role('button',name='下に読み込む',exact=True).click();await idle()
  ok('Repeating a completed read performs network I/O rather than serving a cache',len(await messages())>before)
  anchor=await page.evaluate('window.__app.activeFeed.current("newer")')
  inserted=sign(dict(kind=1,tags=[],content='上方向の追加テスト',created_at=anchor['created_at']+1),4)
  await page.evaluate('(event)=>window.__events.push(event)',inserted)
  top_before=await page.locator(f'.post[data-event-id="{anchor["id"]}"]').evaluate('(node)=>node.getBoundingClientRect().top')
  before=len(await messages());await page.get_by_role('button',name='上に読み込む',exact=True).click();await idle()
  sent=(await messages())[before:]
  ok('Up starts at the viewport top post and a bounded newer time interval',sent[0][2]['since']==anchor['created_at'] and sent[0][2]['until']<=anchor['created_at']+600)
  top_after=await page.locator(f'.post[data-event-id="{anchor["id"]}"]').evaluate('(node)=>node.getBoundingClientRect().top')
  ok('Up preserves the current post screen position',abs(top_before-top_after)<3)
  ok('Up inserts a newly received post just above the current position',await page.locator(f'.post[data-event-id="{inserted["id"]}"]').count()==1)
  now=int(time.time());new=sign(dict(kind=1,tags=[],content='最新取得テスト',created_at=now-1),4)
  await page.evaluate('(event)=>window.__events.push(event)',new)
  before=len(await messages());await page.get_by_role('button',name='最新を読み込む',exact=True).click();await idle()
  sent=(await messages())[before:]
  ok('Latest is based on current time, independent of scroll',sent[0][2]['until']>=now-1 and 'since' not in sent[0][2])
  ok('Latest resets to thirty rows and includes a newly published fixture',await page.locator('.timeline>.post').count()==30 and await page.locator('.post-text:text-is("最新取得テスト")').count()==1)
  ok('Latest returns the timeline to its top',await page.evaluate('scrollY')<10)
  await page.evaluate('window.__testLocation.hash="#/settings"');await page.wait_for_selector('.settings-form')
  ok('Settings have no data-cache section or variable timeline size',await page.get_by_role('button',name='キャッシュを削除').count()==0 and await page.get_by_label('1ページの取得件数',exact=True).count()==0)
  before=len(await messages());await page.locator('[data-view="global"]').click();await idle()
  ok('Returning to the timeline re-requests posts, not known session metadata',len(await messages())==before+1)
  saved=await page.evaluate('Object.keys(Object.fromEntries(window.__saved))')
  ok('No fetched events, queries, likes or profile documents are written to storage',not any(any(part in key for part in ['query:','event:','page:','latest:','likes:','nip05doc:']) for key in saved))
  await page.locator('#account button').click();await idle();await page.wait_for_selector('.composer textarea:not([disabled])')
  sent=await messages()
  ok('Own reactions are fetched automatically with metadata, not a sync button',any(any(f.get('kinds')==[7] and f.get('authors')==[data['keys']['alice']] for f in m[2:]) and any(f.get('kinds')==[0] for f in m[2:]) for m in sent))
  await page.evaluate('document.querySelector("#toasts").replaceChildren()')
  await page.screenshot(path=str(OUT/'navigation-desktop.png'))
  await page.set_viewport_size({'width':390,'height':844});await page.evaluate('scrollTo(0,1500)');await page.wait_for_timeout(200)
  rect=await page.locator('.feed-toolbar').bounding_box()
  ok('Mobile controls follow scroll without overlapping bottom navigation',abs(rect['y']-56)<2 and rect['y']+rect['height']<784)
  ok('All three controls fit on a 390px screen without horizontal overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  await page.screenshot(path=str(OUT/'navigation-mobile.png'))
  await page.set_viewport_size({'width':320,'height':700});await page.wait_for_timeout(100)
  ok('Three buttons also fit a 320px viewport',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  await page.evaluate('(key)=>window.__testLocation.hash=`#/profile/${key}/posts`',data['keys']['bob']);await page.wait_for_selector('.profile-tabs');await idle()
  await page.evaluate('scrollTo(0,1500)');await page.wait_for_timeout(150)
  rect=await page.locator('.feed-toolbar').bounding_box()
  ok('Profile post controls follow scroll without being covered by profile tabs',abs(rect['y']-56)<2 and await page.locator('.feed-toolbar button').first.evaluate('(b)=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}'))
  # Explicit refresh must bypass session profiles, without a duplicate decoration read.
  profile_event=next(e for e in data['events'] if e['kind']==0 and e['pubkey']==data['keys']['bob'])
  metadata=json.loads(profile_event['content']);metadata['display_name']='手動更新の表示名'
  changed=sign(dict(kind=0,tags=profile_event['tags'],content=json.dumps(metadata,ensure_ascii=False),created_at=int(time.time())-1),4)
  await page.evaluate('(event)=>window.__events.push(event)',changed)
  before=len(await messages())
  await page.get_by_role('button',name='プロフィール更新',exact=True).click()
  await idle();await page.wait_for_selector('.profile-info .display-name:text-is("手動更新の表示名")')
  sent=(await messages())[before:]
  profile_reads=[f for m in sent for f in m[2:] if f.get('kinds')==[0]]
  ok('Explicit profile refresh fetches the owner exactly once and paints changed metadata',len(profile_reads)==1 and profile_reads[0]['authors']==[data['keys']['bob']])
  ok('Every finished REQ has a matching CLOSE',len(await messages())==await page.evaluate('window.__messages.filter(m=>m[0]==="CLOSE").length'))
  ok('No browser JavaScript errors',not errors)
  result=dict(mode='Native ES modules with mock relay, storage, navigation and SHA adapter; Chromium only',passed=len(checks),checks=checks,errors=errors,browser=browser.version)
  (OUT/'navigation-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  await browser.close()
 print('RESULT:',len(checks),'navigation checks passed')
if __name__=='__main__':asyncio.run(main())
