"""1.2.2 relationship regressions through native ES modules and Chromium DOM.
The relay speaks simulated WebSocket frames with signed public test fixtures.
The production pool/repository/social/view code is used. No real account,
public relay, extension, native storage or network deployment is exercised.
"""
import asyncio, base64, hashlib, json, os, shutil, time
from pathlib import Path
from playwright.async_api import async_playwright
from browser_offline import html, MOCK
from browser_navigation import LOADER
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/output'; OUT.mkdir(exist_ok=True)

# Faults are injected at the wire, not by replacing the relation resolver.
WIRE=r'''()=>{
 window.__wire={emptyBroad:false,missingReverse:[],missingDirect:[],staleDirect:{},offline:[]};
 const baseSend=WebSocket.prototype.send;
 const match=(e,f)=>(!f.kinds||f.kinds.includes(e.kind))&&(!f.authors||f.authors.includes(e.pubkey))&&(!f.ids||f.ids.includes(e.id))&&(f.since===undefined||e.created_at>=f.since)&&(f.until===undefined||e.created_at<=f.until)&&Object.entries(f).every(([k,v])=>!k.startsWith('#')||e.tags.some(t=>t[0]===k.slice(1)&&v.includes(t[1])));
 WebSocket.prototype.send=function(raw){
  const m=JSON.parse(raw);if(m[0]!=='REQ'){baseSend.call(this,raw);return;}
  __messages.push(m);
  setTimeout(()=>{
   if(__wire.offline.includes(this.url)){this.emit(['CLOSED',m[1],'error: test offline']);return;}
   const selected=new Map();
   for(const f of m.slice(2)){
    if(__wire.emptyBroad&&f.kinds?.includes(3)&&f.authors?.length>1)continue;
    let source=__events;
    if(f.kinds?.includes(3)&&f.authors){
     source=source.filter(e=>e.kind!==3||!__wire.missingDirect.includes(e.pubkey));
     source=source.filter(e=>e.kind!==3||!__wire.staleDirect[e.pubkey]||e.id===__wire.staleDirect[e.pubkey]);
    }
    if(f.kinds?.includes(3)&&f['#p'])source=source.filter(e=>!__wire.missingReverse.includes(e.pubkey));
    for(const e of source.filter(e=>match(e,f)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,f.limit))selected.set(e.id,e);
   }
   for(const e of selected.values())this.emit(['EVENT',m[1],e]);
   this.emit(['EOSE',m[1]]);
  },5);
 };
}'''

async def main():
 checks=[];errors=[];data=fixtures();now=int(time.time())-300
 owner=data['keys']['alice'];bob=data['keys']['bob'];carol=data['keys']['carol']
 own=sign(dict(kind=3,content='',tags=[['p',bob],['p',carol]],created_at=now),3)
 # Fixture keys: alice=3, bob=4, carol=5.
 yes_bob=sign(dict(kind=3,content='',tags=[['p',owner]],created_at=now+10),4)
 yes_carol=sign(dict(kind=3,content='',tags=[['p',owner]],created_at=now+20),5)
 old_bob=sign(dict(kind=3,content='',tags=[],created_at=now-10),4)
 no_bob=sign(dict(kind=3,content='',tags=[],created_at=now+30),4)
 no_carol=sign(dict(kind=3,content='',tags=[],created_at=now+40),5)
 later_carol=sign(dict(kind=3,content='',tags=[['p',owner]],created_at=now+50),5)
 assert bob==yes_bob['pubkey'] and carol==yes_carol['pubkey']
 data['events']=[e for e in data['events'] if e['kind']!=3]+[own,old_bob,yes_bob,yes_carol]
 def ok(name,value=True):
  if not value:raise AssertionError(name)
  checks.append(name);print('PASS:',name,flush=True)
 settings=dict(relays=['ws://127.0.0.1:9876/'],readRelayCount=1,requestGapMs=800,batchSize=30,
  muteContentPatterns=[],muteDisplayNamePatterns=[],mutedPubkeys=[],hideIncompleteProfiles=False,loadImages=False,verifyNip05=False,theme='light')
 sources={p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'js').rglob('*.js')}
 avatar='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/avatar.svg').read_bytes()).decode()
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000},locale='ja-JP')
  context.set_default_timeout(20000)
  await context.expose_function('testGetKey',lambda:owner)
  await context.expose_function('testSign',sign)
  await context.expose_function('testDigest',lambda a:list(hashlib.sha256(bytes(a)).digest()))
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.route('**/*',lambda route:route.abort());await page.set_content(html())
  await page.evaluate(MOCK,dict(data=data,settings=settings,saved={}))
  await page.evaluate(WIRE)
  await page.evaluate('''()=>{window.fetch=__testFetch;Object.defineProperty(window,'SharedWorker',{value:undefined,configurable:true});Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(alg,bytes)=>Uint8Array.from(await testDigest(Array.from(new Uint8Array(bytes)))).buffer}},configurable:true});}''')
  await page.evaluate(LOADER,dict(sources=sources,avatar=avatar,relaxGap=True))
  await page.wait_for_selector('.feed-toolbar')
  async def count():return await page.evaluate('__messages.filter(m=>m[0]==="REQ").length')
  async def rows():return await page.locator('.user-row').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.pubkey)')
  async def nav(tab):
   # Leave and return even when rerunning the same tab: tests view-local reset.
   await page.evaluate('__testLocation.hash="#/global"');await page.wait_for_selector('.feed-toolbar')
   await page.evaluate('(r)=>__testLocation.hash=r',f'#/profile/{owner}/{tab}')
   await page.wait_for_selector('.profile-tabs');await page.wait_for_timeout(80)
  async def click(text):
   await page.get_by_role('button',name=text,exact=True).click()
   await page.wait_for_function('!document.querySelector(".profile-tab-content[aria-busy=true]") && !document.querySelector(".loading")')
   await page.wait_for_timeout(40)
  def badge(key):return page.locator(f'.user-row[data-pubkey="{key}"] .mutual')
  async def mutual(key):return await badge(key).is_visible() and await badge(key).inner_text()=='相互フォロー'
  ok('Initial access remains manual-only',await count()==0)
  await page.evaluate('__wire.emptyBroad=true')
  await nav('following');before=await count();await page.wait_for_timeout(100)
  ok('Following navigation does not fetch contacts',await count()==before)
  await click('フォローを取得')
  ok('All signed following keys render after an empty broad contacts response',set(await rows())=={bob,carol})
  ok('Per-author repairs recover both mutual badges after an empty broad response',await mutual(bob) and await mutual(carol))
  ok('Actual wire issued bounded exact repairs for both identities',await page.evaluate('(keys)=>keys.every(k=>__messages.some(m=>m[0]==="REQ"&&m.length===3&&m[2].kinds?.includes(3)&&m[2].authors?.length===1&&m[2].authors[0]===k))',[bob,carol]))
  await page.evaluate('(keys)=>{__wire.emptyBroad=false;__wire.missingReverse=keys;}',[bob,carol])
  await nav('followers');before=await count();await page.wait_for_timeout(100)
  ok('Follower navigation alone still makes no REQ',await count()==before)
  await click('フォロワーを取得')
  ok('Both missing reverse-index followers are recovered from direct known-followee checks',set(await rows())=={bob,carol})
  ok('Recovered direct followers show both mutual badges',await mutual(bob) and await mutual(carol))
  ok('Direct recovery did not add relay connections',await page.evaluate('__sockets.every(s=>s.url==="ws://127.0.0.1:9876/")'))
  await page.evaluate('(event)=>{__wire.missingReverse=[];__wire.staleDirect={[event.pubkey]:event.id};}',old_bob)
  await nav('followers');await click('フォロワーを取得')
  ok('A newer signed reverse-index follow survives an older negative author response',bob in await rows())
  ok('Stale author response does not remove the mutual badge',await mutual(bob))
  ok('Inconsistent latest-state read is explicitly retryable',await page.get_by_role('button',name='未確認の候補を再確認',exact=True).is_visible())
  await page.evaluate('(key)=>{__wire.staleDirect={};__wire.missingDirect=[key];}',bob)
  await nav('followers');await click('フォロワーを取得')
  ok('Empty author response cannot delete a verified follower',bob in await rows())
  ok('Positive evidence remains sufficient to display mutual status, with uncertainty note',await mutual(bob) and '最新フォロー状態が未確認' in await page.locator('.profile-tab-content').inner_text())
  # Retry must apply a newer signed unfollow, not turn every old seed into truth.
  await page.evaluate('(e)=>{__wire.missingDirect=[];__events.push(e);}',no_bob)
  before=await page.evaluate('__messages.filter(m=>m[0]==="REQ"&&m.slice(2).some(f=>f.kinds?.includes(3)&&f["#p"])).length')
  await click('未確認の候補を再確認')
  after=await page.evaluate('__messages.filter(m=>m[0]==="REQ"&&m.slice(2).some(f=>f.kinds?.includes(3)&&f["#p"])).length')
  ok('A newer signed unfollow removes the earlier uncertain follower',bob not in await rows() and carol in await rows())
  ok('Candidate retry does not advance or rescan the reverse-index cursor',before==after)
  await page.evaluate('(key)=>{__wire.missingDirect=[key];}',carol)
  await nav('following');await click('フォローを取得')
  ok('Missing direct follow evidence is shown as unknown instead of hidden negative status',await badge(carol).is_visible() and await badge(carol).inner_text()=='相互未確認')
  ok('Signed non-mutual followee has no mutual badge',await badge(bob).is_hidden())
  await page.evaluate('__wire.missingDirect=[]');await click('表示中の補助情報を再取得')
  ok('Explicit detail retry turns unknown mutual status into the recovered badge',await mutual(carol))
  before=await count();await page.evaluate('(e)=>__app.repo.accept(e)',no_carol)
  ok('Receiving another user\'s newer unfollow updates an existing badge immediately',await badge(carol).is_hidden())
  await page.evaluate('(e)=>__app.repo.accept(e)',later_carol)
  ok('Receiving another user\'s new follow restores the badge without reloading',await mutual(carol))
  ok('Reactive badge updates themselves issue no network requests',await count()==before)
  # One failed relay must not make the healthy relay's entire directory vanish.
  await page.evaluate('''()=>{__app.settings.value.relays=['ws://127.0.0.1:9876/','ws://127.0.0.1:9877/'];__app.settings.value.readRelayCount=2;__wire.offline=['ws://127.0.0.1:9877/'];}''')
  await nav('followers');await click('フォロワーを取得')
  ok('Healthy relay still contributes the follower when another selected relay fails',carol in await rows())
  ok('Healthy relay evidence still provides its mutual badge',await mutual(carol))
  ok('Failed relay keeps an explicit continuation/retry and warning',await page.get_by_role('button',name='次の30人を表示',exact=True).is_visible() and '取得できません' in await page.locator('.profile-tab-content').inner_text())
  ok('No unexpected outside-relay connection was opened',await page.evaluate('__sockets.every(s=>["ws://127.0.0.1:9876/","ws://127.0.0.1:9877/"].includes(s.url))'))
  # Responsive list/badge rendering, without network activity on scroll.
  await page.set_viewport_size({'width':390,'height':844});before=await count();await page.evaluate('scrollTo(0,800)');await page.wait_for_timeout(100)
  ok('Scrolling on mobile starts no automatic fetch',await count()==before)
  ok('Follower rows and mutual label remain visible in the mobile DOM',carol in await rows() and await mutual(carol))
  await page.screenshot(path=str(OUT/'relationships-mobile.png'),full_page=True)
  ok('Every finite wire subscription is closed',await count()==await page.evaluate('__messages.filter(m=>m[0]==="CLOSE").length'))
  ok('No uncaught browser errors',not errors)
  report=dict(version='1.2.2',mode='Chromium native DOM/modules with signed fixtures; simulated WebSocket, storage, navigation, SHA and spacing adapters; no public relay/account test',passed=len(checks),checks=checks,errors=errors,browser=browser.version)
  (OUT/'relationships-browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  await browser.close()
 print('RESULT:',len(checks),'checks passed')
if __name__=='__main__':asyncio.run(main())
