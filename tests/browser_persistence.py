"""1.2.0 behaviour regression. Native ES modules/DOM/signature checks, simulated
relay, localStorage, navigation and SHA adapter. No native IndexedDB/SharedWorker
or public relay is claimed here. The environment blocks HTTP page navigation.
Run: python tests/browser_persistence.py
"""
import asyncio, base64, hashlib, json, os, shutil, time
from pathlib import Path
from playwright.async_api import async_playwright
from browser_offline import html, MOCK
from browser_navigation import LOADER
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/output'; OUT.mkdir(exist_ok=True)

async def main():
 checks=[];errors=[];data=fixtures();key_calls=0;sign_calls=0
 def ok(name,value=True):
  if not value:raise AssertionError(name)
  checks.append(name);print('PASS:',name,flush=True)
 settings=dict(relays=['ws://127.0.0.1:9876/'],readRelayCount=1,requestGapMs=800,batchSize=30,
  muteContentPatterns=[],muteDisplayNamePatterns=[],mutedPubkeys=[],hideIncompleteProfiles=False,loadImages=False,verifyNip05=True,theme='light')
 sources={p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'js').rglob('*.js')}
 avatar='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/avatar.svg').read_bytes()).decode()
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1000},locale='ja-JP')
  context.set_default_timeout(14000)
  async def getkey():
   nonlocal key_calls;key_calls+=1;return data['keys']['alice']
  async def signing(e):
   nonlocal sign_calls;sign_calls+=1;return sign(e)
  await context.expose_function('testGetKey',getkey)
  await context.expose_function('testSign',signing)
  await context.expose_function('testDigest',lambda a:list(hashlib.sha256(bytes(a)).digest()))
  async def load(saved=None):
   page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   await page.route('**/*',lambda route:route.abort());await page.set_content(html())
   await page.evaluate(MOCK,dict(data=data,settings=settings,saved=saved or {}))
   await page.evaluate("""()=>{
    window.__http=[];window.fetch=(url,options)=>{if(String(url).includes('/.well-known/'))window.__http.push(String(url));return window.__testFetch(url,options);};
    Object.defineProperty(window,'SharedWorker',{value:undefined,configurable:true});
    Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(alg,bytes)=>Uint8Array.from(await window.testDigest(Array.from(new Uint8Array(bytes)))).buffer}},configurable:true});
   }""")
   await page.evaluate(LOADER,dict(sources=sources,avatar=avatar))
   await page.wait_for_selector('.feed-toolbar');await page.wait_for_timeout(100)
   return page
  page=await load()
  async def reqs():return await page.evaluate('window.__messages.filter(m=>m[0]==="REQ")')
  async def http():return await page.evaluate('window.__http.length')
  async def idle():await page.wait_for_function('window.__app.activeFeed && !window.__app.activeFeed.operation')
  async def nav(route,selector):
   await page.evaluate('(r)=>window.__testLocation.hash=r',route)
   await page.wait_for_selector(selector);await page.wait_for_timeout(130)
  async def read(label):
   await page.get_by_role('button',name=label,exact=True).click();await idle()
  ok('Anonymous initial access: zero REQ, zero NIP-05 HTTP and zero relay sockets',not await reqs() and await http()==0 and await page.evaluate('__sockets.length')==0)
  ok('Initial timeline contains no fetched posts',await page.locator('.timeline>.post').count()==0)
  ok('All three original manual read controls remain',await page.locator('.feed-toolbar button').all_text_contents()==['下に読み込む','上に読み込む','最新を読み込む'])
  await read('最新を読み込む')
  ok('Explicit cold anonymous read: two REQs and thirty posts',len(await reqs())==2 and await page.locator('.timeline>.post').count()==30)
  await page.wait_for_selector('.nip05-badge.valid')
  ok('Mismatched NIP-05 is displayed as invalid',await page.locator('.nip05-badge.invalid').count()>0)
  ok('Metadata records and NIP-05 status are written to profile-only storage',await page.evaluate('[...__saved].filter(([k])=>k.includes(":profiles:")).length')==4)
  n=len(await reqs());h=await http();await page.evaluate('scrollTo(0,1600)');await page.wait_for_timeout(500)
  ok('Scrolling does not send REQs or reverify NIP-05',len(await reqs())==n and await http()==h)
  rect=await page.locator('.feed-toolbar').bounding_box()
  ok('Desktop three-button toolbar remains sticky',abs(rect['y']-56)<2)
  anchor=await page.evaluate('__app.activeFeed.current("older")');count=await page.locator('.timeline>.post').count()
  await read('下に読み込む');sent=(await reqs())[n:]
  ok('Down uses the viewport post timestamp and adds at most thirty rows',sent[0][2]['until']==anchor['created_at'] and 0<=await page.locator('.timeline>.post').count()-count<=30)
  ok('Known authors and their verification are reused for the next page',not any(f.get('kinds')==[0] for m in sent for f in m[2:]) and await http()==h)
  upper=await page.evaluate('__app.activeFeed.current("newer")')
  new=sign(dict(kind=1,tags=[],content='現在位置の上に追加した投稿',created_at=upper['created_at']+1),4)
  await page.evaluate('(e)=>__events.push(e)',new)
  top=await page.locator(f'.post[data-event-id="{upper["id"]}"]').evaluate('(e)=>e.getBoundingClientRect().top')
  await read('上に読み込む')
  ok('Up preserves the reading position',abs(top-await page.locator(f'.post[data-event-id="{upper["id"]}"]').evaluate('(e)=>e.getBoundingClientRect().top'))<3)
  for width in (390,320):
   await page.set_viewport_size({'width':width,'height':844});await page.wait_for_timeout(100)
   ok(f'Three buttons fit a {width}px viewport',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  await page.set_viewport_size({'width':1440,'height':1000})
  bob=data['keys']['bob'];alice=data['keys']['alice']
  n=len(await reqs());h=await http();await nav(f'#/profile/{bob}/posts','.profile-tabs')
  ok('Known profile navigation reads only stored metadata, not posts',len(await reqs())==n and await http()==h and await page.locator('.timeline>.post').count()==0)
  ok('Known profile name is immediately restored',await page.locator('.profile-info .display-name').inner_text()=='ボブ')
  for tab,label in [('following','フォロー'),('followers','フォロワー'),('mutes','ミュート'),('relays','リレー')]:
   n=len(await reqs());h=await http();await nav(f'#/profile/{bob}/{tab}',f'button:text-is("{label}を取得")')
   ok(f'{label} tab does not automatically fetch any data',len(await reqs())==n and await http()==h)
  unknown='f'*64;n=len(await reqs());await nav(f'#/profile/{unknown}/posts','.profile-tabs')
  ok('Uncached profile navigation also waits for explicit acquisition',len(await reqs())==n and '未取得のプロフィール' in await page.locator('.profile-info').inner_text())
  await nav(f'#/profile/{bob}/posts','.profile-tabs');await read('最新を読み込む')
  post_ids=await page.locator('.timeline>.post').evaluate_all('(rows)=>rows.map(e=>e.dataset.eventId)')
  original=next(e for e in data['events'] if e['kind']==0 and e['pubkey']==bob)
  value=json.loads(original['content']);value['display_name']='保存更新テスト'
  updated=sign(dict(kind=0,tags=[],content=json.dumps(value,ensure_ascii=False),created_at=int(time.time())-1),4)
  await page.evaluate('(e)=>__events.push(e)',updated)
  n=len(await reqs());h=await http()
  await page.get_by_role('button',name='プロフィールを更新',exact=True).click()
  await page.wait_for_selector('.profile-info .display-name:text-is("保存更新テスト")')
  sent=(await reqs())[n:]
  ok('Profile update fetches only kind:0 for the selected user',len(sent)==1 and all(f.get('kinds')==[0] and f['authors']==[bob] for m in sent for f in m[2:]))
  ok('Profile update does not reset or fetch the post list',post_ids==await page.locator('.timeline>.post').evaluate_all('(rows)=>rows.map(e=>e.dataset.eventId)'))
  ok('Explicit profile update refreshes NIP-05 exactly once',await http()==h+1)
  n=len(await reqs());h=await http();await nav('#/global','.feed-toolbar')
  ok('Returning to global does not refetch posts',len(await reqs())==n and await page.locator('.timeline>.post').count()==0)
  await page.locator('#account button').click();await page.wait_for_selector('.composer textarea:not([disabled])');await page.wait_for_timeout(150)
  ok('Login itself causes no relay/verification requests',len(await reqs())==n and await http()==h and key_calls==1)
  saved=await page.evaluate('Object.fromEntries(__saved)');await page.close();page=await load(saved)
  ok('Fresh module instance restores login and profile without network',not await reqs() and await http()==0 and key_calls==1 and await page.locator('#account strong').inner_text()=='アリス')
  await nav(f'#/profile/{bob}/posts','.profile-tabs')
  ok('Profile persisted through complete page replacement',await page.locator('.profile-info .display-name').inner_text()=='保存更新テスト' and not await reqs())
  n=len(await reqs());h=await http();await read('最新を読み込む')
  sent=(await reqs())[n:]
  ok('Restored profile page fetches posts and likes, never cached metadata',len(sent)==2 and not any(f.get('kinds')==[0] for m in sent for f in m[2:]) and await http()==h)
  for view in ('home','notifications','global'):
   n=len(await reqs());h=await http();await nav('#/'+view,'.feed-toolbar')
   ok(f'{view} navigation does not load posts or account lists',len(await reqs())==n and await http()==h and await page.locator('.timeline>.post').count()==0)
   await read('最新を読み込む');sent=(await reqs())[n:]
   ok(f'{view} explicit read uses persisted identities and does not redo NIP-05',not any(f.get('kinds')==[0] for m in sent for f in m[2:]) and await http()==h)
  n=len(await reqs());await nav('#/thread/'+data['root'],'button:text-is("投稿を取得")')
  ok('Thread navigation does not load root, parent or replies',len(await reqs())==n)
  await page.get_by_role('button',name='投稿を取得',exact=True).click();await page.wait_for_selector('.thread-focus');await page.wait_for_selector('.feed-toolbar')
  ok('Thread root read does not automatically load the reply list',await page.locator('.thread-replies .timeline>.post').count()==0)
  h=await http();n=len(await reqs());await read('最新を読み込む')
  ok('Reply authors use persistent profiles',not any(f.get('kinds')==[0] for m in (await reqs())[n:] for f in m[2:]) and await http()==h)
  for tab,label in [('following','フォロー'),('followers','フォロワー'),('mutes','ミュート')]:
   await nav(f'#/profile/{alice}/{tab}',f'button:text-is("{label}を取得")');n=len(await reqs());h=await http()
   await page.get_by_role('button',name=f'{label}を取得',exact=True).click()
   await page.wait_for_selector('.user-row');await page.wait_for_timeout(100)
   sent=(await reqs())[n:]
   ok(f'{label} explicit read uses cached user profiles but fresh lists',len(sent)>0 and not any(f.get('kinds')==[0] for m in sent for f in m[2:]) and await http()==h)
   await nav('#/settings','.settings-form');n=len(await reqs())
   await nav(f'#/profile/{alice}/{tab}',f'button:text-is("{label}を取得")')
   ok(f'{label} rows are not restored as a list cache on revisit',await page.locator('.user-row').count()==0 and len(await reqs())==n)
   await page.get_by_role('button',name=f'{label}を取得',exact=True).click();await page.wait_for_selector('.user-row')
   ok(f'{label} re-read sends fresh REQs',len(await reqs())>n)
  await nav(f'#/profile/{alice}/relays','button:text-is("リレーを取得")')
  n=len(await reqs());await page.get_by_role('button',name='リレーを取得',exact=True).click();await page.wait_for_selector('.public-relays .relay-row')
  ok('Public relay read explicitly fetches kind:10002',len(await reqs())==n+1 and (await reqs())[-1][2]['kinds']==[10002])
  config=await page.evaluate('JSON.stringify(__app.settings.value.relays)')
  # Add an unknown tag on the relay before the write: read/modify/write must preserve it.
  current=next(e for e in data['events'] if e['kind']==10002 and e['pubkey']==alice)
  newer=sign(dict(kind=10002,tags=current['tags']+[['x','keep-this']],content='preserved-content',created_at=int(time.time())))
  await page.evaluate('(e)=>__events.push(e)',newer)
  n=len(await reqs());await page.get_by_label('新しい公開リレー',exact=True).fill('wss://added.example.com')
  await page.get_by_label('用途',exact=True).select_option('write')
  await page.get_by_role('button',name='公開リレーに追加',exact=True).click()
  await page.wait_for_selector('.public-relays code:text-is("wss://added.example.com/")')
  published=await page.evaluate('__messages.filter(m=>m[0]==="EVENT").at(-1)[1]')
  ok('Adding a public relay performs one fresh latest read before publishing',len(await reqs())==n+1)
  ok('Published relay event preserves existing modes, unknown tags and content',published['kind']==10002 and ['x','keep-this'] in published['tags'] and all(t in published['tags'] for t in current['tags']) and published['content']=='preserved-content')
  ok('New public relay has selected write-only mode and mikeryan client tag',['r','wss://added.example.com/','write'] in published['tags'] and ['client','mikeryan'] in published['tags'])
  ok('Adding a public relay does not modify settings or connect to that URL',await page.evaluate('JSON.stringify(__app.settings.value.relays)')==config and await page.evaluate('__sockets.every(s=>s.url==="ws://127.0.0.1:9876/")'))
  nsign=sign_calls;await page.get_by_label('新しい公開リレー',exact=True).fill('wss://ADDED.example.com/')
  await page.get_by_role('button',name='公開リレーに追加',exact=True).click();await page.wait_for_function('!document.querySelector(".public-relay-form button").disabled')
  ok('Duplicate normalized relay is not signed or published twice',sign_calls==nsign)
  concurrent=sign(dict(kind=10002,tags=published['tags']+[['r','wss://concurrent.example/']],content=published['content'],created_at=published['created_at']+1))
  await page.evaluate('(e)=>__events.push(e)',concurrent)
  await page.get_by_role('button',name='wss://added.example.com/ を削除',exact=True).click()
  await page.wait_for_selector('.public-relays code:text-is("wss://concurrent.example/")')
  removed=await page.evaluate('__messages.filter(m=>m[0]==="EVENT").at(-1)[1]')
  ok('Delete merges against latest list, retaining a concurrent addition',not any(t[0]=='r' and t[1]=='wss://added.example.com/' for t in removed['tags']) and ['r','wss://concurrent.example/'] in removed['tags'])
  ok('Delete preserves unrelated tags, content, read/write modes and settings',['x','keep-this'] in removed['tags'] and removed['content']=='preserved-content' and await page.evaluate('JSON.stringify(__app.settings.value.relays)')==config)
  await page.evaluate('__deny=true');await page.get_by_label('新しい公開リレー',exact=True).fill('wss://denied.example.com/')
  await page.get_by_role('button',name='公開リレーに追加',exact=True).click();await page.wait_for_selector('.profile-tab-content .form-error:not([hidden])')
  ok('Signing refusal preserves relay input and shows inline error',await page.get_by_label('新しい公開リレー',exact=True).input_value()=='wss://denied.example.com/')
  await page.evaluate('__deny=false;document.querySelector("#toasts").replaceChildren()')
  await page.screenshot(path=str(OUT/'relay-editor-desktop.png'))
  await page.set_viewport_size({'width':390,'height':844});await page.evaluate('scrollTo(0,330)');await page.wait_for_timeout(100)
  ok('Relay editor has no horizontal overflow on mobile',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  await page.screenshot(path=str(OUT/'relay-editor-mobile.png'))
  await page.set_viewport_size({'width':1440,'height':1000})
  await nav(f'#/profile/{bob}/relays','button:text-is("リレーを取得")')
  ok('Another user has no relay-add or relay-delete UI',await page.locator('.public-relay-form').count()==0 and await page.locator('.public-relays button').count()==0)
  await nav(f'#/profile/{alice}/relays','button:text-is("リレーを取得")')
  ok('Public relay list is not restored from storage',await page.locator('.public-relays .relay-row').count()==0)
  # Regression for the original getter-only textarea bug.
  await page.get_by_role('button',name='プロフィールを編集',exact=True).click();await page.wait_for_selector('dialog[open]')
  ok('Profile editor opens with textarea and saved data',await page.locator('dialog textarea').count()==1 and await page.get_by_label('表示名',exact=True).input_value()=='アリス')
  await page.get_by_role('button',name='閉じる',exact=True).click()
  records=await page.evaluate('[...__saved].filter(([k])=>k.includes(":profiles:")).map(([k,v])=>JSON.parse(v))')
  ok('All persisted read-data records are kind:0, never posts, contacts, followers, mutes, relays or reactions',all(r['event']['kind']==0 for r in records) and len(records)==4)
  ok('Cached verification is bound to both event ID and public key',all(not r.get('verification') or r['verification']['eventId']==r['event']['id'] and r['verification']['pubkey']==r['event']['pubkey'] for r in records))
  ok('No forbidden generic query/page/list cache was introduced',await page.evaluate('![...__saved.keys()].some(k=>/query:|page:|latest:|likes:|followers:/.test(k))'))
  n=len(await reqs());h=await http();await nav('#/settings','.settings-form');await page.get_by_role('button',name='ログアウト',exact=True).click();await page.wait_for_selector('.feed-toolbar')
  ok('Logout preserves public profile cache without fetching',len(await reqs())==n and await http()==h and await page.evaluate('[...__saved.keys()].filter(k=>k.includes(":profiles:")).length')==4)
  ok('Every finished REQ has a CLOSE',len(await reqs())==await page.evaluate('__messages.filter(m=>m[0]==="CLOSE").length'))
  ok('No JavaScript page errors',not errors)
  result=dict(mode='Chromium native modules and DOM with mocked transport/localStorage/navigation/SHA; no native IndexedDB/SharedWorker',passed=len(checks),checks=checks,errors=errors,browser=browser.version)
  (OUT/'persistence-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  await browser.close()
 print('RESULT:',len(checks),'checks passed')
if __name__=='__main__':asyncio.run(main())
