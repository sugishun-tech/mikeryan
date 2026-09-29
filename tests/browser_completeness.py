"""1.2.2 missing-row regressions, using native ES modules/Chromium DOM.
Signed fixtures plus simulated relay/storage/navigation/SHA; optional failures
are injected into the repository/social boundary. Queue timing is tested in Node.
No public account, live relay, native IndexedDB, SharedWorker or extension.
Run: python3 tests/browser_completeness.py
"""
import asyncio, base64, hashlib, json, os, shutil, time
from pathlib import Path
from playwright.async_api import async_playwright
from browser_offline import html, MOCK
from browser_navigation import LOADER
from fixture_signer import fixtures, sign, point
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/output'; OUT.mkdir(exist_ok=True)

async def main():
 checks=[];errors=[];data=fixtures();now=int(time.time())-120;owner=data['keys']['alice']
 users=[f'{point(n).x:064x}' for n in range(20,85)];stale=users[20]
 data['events']=[e for e in data['events'] if e['kind'] not in (3,10000)]
 data['events'] += [sign(dict(kind=k,content='',tags=[['p',u] for u in users],created_at=now),3) for k in (3,10000)]
 data['events'] += [sign(dict(kind=3,content='',tags=[['p',owner]],created_at=now-200+i),20+i) for i in range(65)]
 data['events'].append(sign(dict(kind=3,content='',tags=[],created_at=now-1),40))
 # Explicit empty metadata is allowed for list rows. Do not invent profile names.
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
  await page.evaluate("""()=>{
   window.fetch=__testFetch;Object.defineProperty(window,'SharedWorker',{value:undefined,configurable:true});
   Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(alg,bytes)=>Uint8Array.from(await testDigest(Array.from(new Uint8Array(bytes)))).buffer}},configurable:true});
  }""")
  await page.evaluate(LOADER,dict(sources=sources,avatar=avatar,relaxGap=True))
  await page.wait_for_selector('.feed-toolbar')
  async def reqs():return await page.evaluate('__messages.filter(m=>m[0]==="REQ").length')
  async def rows():return await page.locator('.user-row').evaluate_all('(a)=>a.map(e=>e.dataset.pubkey)')
  async def cards():return await page.locator('.timeline>.post').evaluate_all('(a)=>a.map(e=>e.dataset.eventId)')
  async def nav(tab):
   await page.evaluate('(r)=>__testLocation.hash=r',f'#/profile/{owner}/{tab}')
   await page.wait_for_selector('.profile-tabs');await page.wait_for_timeout(100)
  async def listidle():
   await page.wait_for_function('!document.querySelector(".profile-tab-content[aria-busy=true]") && !document.querySelector(".loading")')
   await page.wait_for_timeout(50)
  async def click(name):
   await page.get_by_role('button',name=name,exact=True).click();await listidle()
  async def read(name):
   await page.get_by_role('button',name=name,exact=True).click()
   await page.wait_for_function('__app.activeFeed && !__app.activeFeed.operation')
  ok('Initial access is manual-only',await reqs()==0)
  # Failed optional mutual lookup cannot prevent rendering signed membership.
  await page.evaluate("""()=>{window.__back=__app.social.followingBack.bind(__app.social);__app.social.followingBack=async()=>{throw Error('injected mutual lookup failure');};}""")
  await nav('following');n=await reqs();await page.wait_for_timeout(100)
  ok('Following navigation alone sends no REQ',await reqs()==n)
  await click('フォローを取得')
  ok('First 30 signed following keys appear despite mutual lookup failure',await rows()==users[:30])
  ok('Unknown mutual state is explicit, not a missing user',await page.get_by_text('相互未確認',exact=True).count()==30)
  ok('Auxiliary failure provides a retry without hiding keys',await page.get_by_role('button',name='表示中の補助情報を再取得').is_visible())
  await click('次の30人を表示');ok('Second following page retains all 60 distinct users',await rows()==users[:60])
  await click('次の30人を表示');ok('Last following page includes all 65 in source order',await rows()==users)
  ok('Following end hides more only after all list keys are rendered',await page.get_by_role('button',name='次の30人を表示').is_hidden())
  await page.evaluate('()=>{__app.social.followingBack=__back;}')
  await click('表示中の補助情報を再取得')
  ok('Retry updates mutual labels without duplicate rows',await rows()==users and await page.locator('.mutual:not([hidden])').count()==64)
  # Public mute list is not run through metadata or account mute filtering.
  await page.evaluate("""()=>{window.__profiles=__app.repo.profiles.bind(__app.repo);__app.repo.profiles=async()=>{throw Error('injected profile failure');};}""")
  await nav('mutes');n=await reqs();await page.wait_for_timeout(100)
  ok('Mute tab navigation alone sends no REQ',await reqs()==n)
  await click('ミュートを取得');ok('Mute keys render even when profiles fail',await rows()==users[:30])
  await click('次の30人を表示');await click('次の30人を表示')
  ok('All 65 public mute keys survive failed auxiliary reads',await rows()==users)
  # Two synchronously queued refresh clicks share the same operation.
  before=await reqs()
  await page.evaluate("""()=>{const b=[...document.querySelectorAll('.profile-tab-content button')].find(b=>b.textContent==='一覧を更新');b.click();b.click();}""")
  await listidle();ok('Double refresh does not advance two pages or duplicate primary reads',await rows()==users[:30] and await reqs()==before+1)
  # Failed validation keeps verified discovery evidence visible as uncertain;
  # unknown identities are retried without throwing away other users.
  await page.evaluate("""()=>{window.__attempts=[];__app.social.followingBack=async(owner,keys,options)=>{__attempts.push([...keys]);if(__attempts.length===1)throw Error('injected essential validation failure');return __back(owner,keys,options);};}""")
  await nav('followers');await click('フォロワーを取得')
  first=await page.evaluate('__attempts[0]')
  ok('Verified discovery rows survive a failed latest-state read',len(await rows())==30 and len(first)>=30)
  ok('Latest-state uncertainty is visible instead of silently removing rows','最新フォロー状態が未確認' in await page.locator('.profile-tab-content').inner_text())
  ok('Validation failure exposes candidate retry',await page.get_by_role('button',name='未確認の候補を再確認').is_visible())
  await click('未確認の候補を再確認')
  ok('Candidate retry includes the same failed identities without a new discovery page',set(await page.evaluate('__attempts[1]')).issubset(set(first)))
  ok('Retry does not remove valid first-page followers',len(await rows())>=30)
  ok('Failed follower metadata does not hide verified users',await page.get_by_role('button',name='表示中の補助情報を再取得').is_visible())
  for _ in range(12):
   retry=page.get_by_role('button',name='未確認の候補を再確認',exact=True)
   more=page.get_by_role('button',name='次の30人を表示',exact=True)
   if await retry.is_visible():await click('未確認の候補を再確認')
   elif await more.is_visible():await click('次の30人を表示')
   else:break
  actual=await rows();ok('All 64 current followers appear exactly once',len(actual)==64 and set(actual)==set(users)-{stale})
  ok('Stale follower is excluded by latest signed contact state, not profile availability',stale not in actual)
  ok('Follower end is checked without losing existing rows',await page.get_by_role('button',name='次の30人を表示').is_hidden())
  await page.evaluate('()=>{__app.repo.profiles=__profiles;__app.social.followingBack=__back;}')
  # Fresh latest read fails with NONEMPTY data: never erase the old timeline or
  # install a cursor from the fast relay while another relay has not completed.
  await page.evaluate('__testLocation.hash="#/global"');await page.wait_for_selector('.feed-toolbar')
  await read('最新を読み込む');old=await cards();ok('Successful initial feed shows 30 cards',len(old)==30)
  new=sign(dict(kind=1,content='欠落防止・最新取得の再試行',tags=[],created_at=int(time.time())-1),4)
  await page.evaluate('(e)=>__events.push(e)',new)
  await page.evaluate("""()=>{window.__query=__app.repo.query.bind(__app.repo);__app.repo.query=async(f,o)=>{const r=await __query(f,o);return o?.page?{...r,events:r.events.slice(0,2),complete:false,errors:[{reason:'injected relay failure'}]}:r;};}""")
  await read('最新を読み込む')
  ok('Nonempty partial latest keeps all previous DOM cards',await cards()==old)
  ok('Partial read shows unfinished status rather than no-posts', '未完了' in await page.locator('.feed-status').inner_text())
  await page.evaluate('()=>{__app.repo.query=__query;}');await read('最新を読み込む')
  ok('Latest retry includes missing new post and keeps the 30-card bound',new['id'] in await cards() and len(await cards())==30)
  # Metadata failures must not be confused with intentionally nameless profiles
  # when the existing incomplete-profile display filter is enabled.
  await page.evaluate('__testLocation.hash="#/settings"');await page.wait_for_selector('.settings-form')
  unknown=sign(dict(kind=1,content='名前取得失敗でも位置を飛ばさない',tags=[],created_at=int(time.time())),90)
  profile=sign(dict(kind=0,content=json.dumps({'name':'missing','display_name':'再取得した名前'},ensure_ascii=False),tags=[],created_at=now),90)
  await page.evaluate('(events)=>__events.push(...events)',[unknown,profile])
  await page.evaluate("""()=>{__app.settings.value.hideIncompleteProfiles=true;window.__decorate=__app.repo.decorate.bind(__app.repo);__app.repo.decorate=async()=>({events:[],complete:false,errors:[{reason:'injected metadata failure'}]});__testLocation.hash='#/global';}""")
  await page.wait_for_selector('.feed-toolbar');await read('最新を読み込む')
  ok('Unknown metadata failure leaves the pager retryable',await page.evaluate('__app.activeFeed.pager.events.size')==0)
  ok('Unknown metadata failure is explicitly identified', '投稿者情報の取得が未完了' in await page.locator('.feed-status').inner_text())
  await page.evaluate('()=>{__app.repo.decorate=__decorate;}');await read('最新を読み込む')
  ok('Metadata retry recovers the originally undisplayed post',unknown['id'] in await cards())
  ok('Existing incomplete-profile preference was not disabled by recovery',await page.evaluate('__app.settings.value.hideIncompleteProfiles') is True)
  # Notifications use the same no-partial-commit pagination.
  await page.locator('#account button').click();await page.wait_for_selector('.composer textarea:not([disabled])')
  await page.evaluate('__testLocation.hash="#/notifications"');await page.wait_for_selector('.feed-toolbar')
  await read('最新を読み込む');before=await cards()
  mention=sign(dict(kind=1,content='通知の取得漏れ再試行',tags=[['p',owner]],created_at=int(time.time())),4)
  await page.evaluate('(e)=>__events.push(e)',mention)
  await page.evaluate("""()=>{__app.repo.query=async(f,o)=>{const r=await __query(f,o);return o?.page?{...r,complete:false}:r;};}""")
  await read('最新を読み込む');ok('Failed notification refresh retains old notification cards',await cards()==before)
  await page.evaluate('()=>{__app.repo.query=__query;}');await read('最新を読み込む')
  ok('Notification retry restores the missed mention',mention['id'] in await cards())
  ok('All finished finite requests have CLOSE',await reqs()==await page.evaluate('__messages.filter(m=>m[0]==="CLOSE").length'))
  ok('No uncaught browser JavaScript errors',not errors)
  result=dict(mode='Native Chromium modules/DOM; signed fixtures, mocked relay/storage/navigation/SHA, injected failures; queue spacing disabled only in this UI suite',passed=len(checks),checks=checks,errors=errors,browser=browser.version)
  (OUT/'completeness-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  await page.screenshot(path=str(OUT/'completeness-desktop.png'))
  await browser.close()
 print('RESULT:',len(checks),'checks passed')
if __name__=='__main__':asyncio.run(main())
