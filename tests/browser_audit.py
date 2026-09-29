"""Cross-feature UI fault regressions. Native DOM/modules, simulated relay,
NIP-07, navigation, storage and SHA transport. No public accounts or live relays.
Run: CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_audit.py
"""
import asyncio, base64, hashlib, json, os, shutil, sys
from pathlib import Path
from playwright.async_api import async_playwright
from browser_offline import html, MOCK
from browser_navigation import LOADER
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/output';OUT.mkdir(exist_ok=True)

async def main():
    checks=[];data=fixtures();alice=data['keys']['alice'];bob=data['keys']['bob']
    settings=dict(relays=['ws://127.0.0.1:9876/'],readRelayCount=1,requestGapMs=800,batchSize=30,
        muteContentPatterns=[],muteDisplayNamePatterns=[],mutedPubkeys=[],hideIncompleteProfiles=False,
        loadImages=False,verifyNip05=False,theme='light')
    sources={p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'js').rglob('*.js')}
    avatar='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/avatar.svg').read_bytes()).decode()
    def check(name,value,detail=None):
        row={'name':name,'passed':bool(value)}
        if detail is not None:row['detail']=str(detail)
        checks.append(row);print(('PASS: ' if value else 'FAIL: ')+name,flush=True)
        return bool(value)
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':1440,'height':1000},locale='ja-JP')
        context.set_default_timeout(10000)
        await context.expose_function('testGetKey',lambda:alice)
        await context.expose_function('testSign',sign)
        await context.expose_function('testSignB',lambda e:sign(e,4))
        await context.expose_function('testDigest',lambda a:list(hashlib.sha256(bytes(a)).digest()))
        async def load():
            page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            await page.route('**/*',lambda route:route.abort());await page.set_content(html())
            await page.evaluate(MOCK,dict(data=data,settings=settings,saved={}))
            await page.evaluate("""()=>{
                window.fetch=window.__testFetch;
                Object.defineProperty(window,'SharedWorker',{value:undefined,configurable:true});
                Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(alg,bytes)=>Uint8Array.from(await testDigest(Array.from(new Uint8Array(bytes)))).buffer}},configurable:true});
            }""")
            await page.evaluate(LOADER,dict(sources=sources,avatar=avatar,relaxGap=True))
            await page.wait_for_selector('.feed-toolbar')
            return page,errors
        async def login(page):
            await page.locator('#account button').click();await page.wait_for_selector('.composer textarea:not([disabled])')
        async def nav(page,route,selector):
            await page.evaluate('(r)=>__testLocation.hash=r',route);await page.wait_for_selector(selector);await page.wait_for_timeout(60)
        async def scenario(name,fn):
            page,errors=await load()
            try:await fn(page)
            except Exception as e:check(name+' completed',False,str(e))
            check(name+': no uncaught JavaScript errors',not errors,errors or None)
            await page.close()

        async def drafts(page):
            await login(page)
            await page.evaluate("""()=>{const original=__app.social.post.bind(__app.social);__app.social.post=async(...args)=>{window.__waiting=true;await new Promise(r=>window.__release=r);return original(...args);};}""")
            area=page.locator('.composer textarea');await area.fill('送信する本文')
            await page.locator('#view').get_by_role('button',name='ポストする',exact=True).click();await page.wait_for_function('window.__waiting')
            check('Posting disables duplicate-submit button',await page.locator('#view').get_by_role('button',name='ポストする',exact=True).is_disabled())
            await area.fill('送信中に書いた次の下書き');await page.evaluate('__release()')
            await page.wait_for_function('!document.querySelector(".composer button").disabled')
            check('Typing while a post is in flight does not lose the next draft',await area.input_value()=='送信中に書いた次の下書き')
            check('Newer draft remains in browser storage',await page.evaluate('[...__saved.values()].includes("送信中に書いた次の下書き")'))
            check('Exactly the submitted text is published once',await page.evaluate('__messages.filter(m=>m[0]==="EVENT"&&m[1].kind===1&&m[1].content==="送信する本文").length')==1)
            for width in (320,390,768):
                await page.set_viewport_size({'width':width,'height':844})
                check(f'Composer and toolbar fit {width}px after asynchronous send',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            await page.screenshot(path=str(OUT/'audit-mobile.png'))
        await scenario('Draft preservation',drafts)

        async def stale_post(page):
            await login(page)
            await page.evaluate("""()=>{const original=__app.social.post.bind(__app.social);__app.social.post=async(...args)=>{const event=await original(...args);window.__accepted=true;await new Promise(r=>window.__release=r);return event;};}""")
            await page.locator('.composer textarea').fill('前のアカウントの投稿')
            await page.locator('#view').get_by_role('button',name='ポストする',exact=True).click();await page.wait_for_function('window.__accepted')
            await page.evaluate('(key)=>{nostr.getPublicKey=async()=>key;nostr.signEvent=e=>testSignB(e);return __app.session.login();}',bob)
            await page.wait_for_selector('.composer textarea:not([disabled])');await page.evaluate('__release()');await page.wait_for_timeout(250)
            check('Old composer completion does not insert posts into the new account view',await page.locator('.timeline>.post').count()==0)
            check('Old composer completion does not fetch the new account timeline',await page.evaluate('__messages.filter(m=>m[0]==="REQ").length')==0)
        await scenario('Late composer completion',stale_post)

        async def edit_merge(page):
            await login(page);await nav(page,f'#/profile/{alice}/posts','.profile-tabs')
            await page.get_by_role('button',name='プロフィールを更新',exact=True).click();await page.wait_for_selector('.profile-info .display-name:text-is("アリス")')
            await page.get_by_role('button',name='プロフィールを編集',exact=True).click();await page.wait_for_selector('dialog[data-profile-editor]')
            original=next(e for e in data['events'] if e['kind']==0 and e['pubkey']==alice)
            profile=json.loads(original['content']);profile['about']='別のクライアントで更新された自己紹介'
            updated=sign(dict(kind=0,content=json.dumps(profile,ensure_ascii=False),tags=original['tags'],created_at=original['created_at']+100))
            await page.evaluate('(e)=>__events.push(e)',updated)
            await page.get_by_label('表示名',exact=True).fill('今回編集した表示名')
            await page.get_by_role('button',name='保存する',exact=True).click();await page.wait_for_selector('dialog[data-profile-editor]',state='detached')
            sent=await page.evaluate('__messages.filter(m=>m[0]==="EVENT"&&m[1].kind===0).at(-1)?.[1]')
            body=json.loads(sent['content'])
            check('Profile editor changes only edited fields, preserving newer remote fields',body['about']==profile['about'])
            check('Profile editor still publishes the edited display name',body['display_name']=='今回編集した表示名')
            check('Profile editor preserves unknown metadata',body['custom_field']=={'preserved':True})
        await scenario('Profile merge',edit_merge)

        async def editor_session(page):
            await login(page);await nav(page,f'#/profile/{alice}/posts','.profile-tabs')
            await page.get_by_role('button',name='プロフィールを編集',exact=True).click();await page.wait_for_selector('dialog[data-profile-editor]')
            await page.evaluate('(key)=>{nostr.getPublicKey=async()=>key;return __app.session.login();}',bob);await page.wait_for_timeout(150)
            check('Changing account closes the previous account profile editor',await page.locator('dialog[data-profile-editor]').count()==0)
            check('Changing account alone does not sign or publish edits',await page.evaluate('__messages.filter(m=>m[0]==="EVENT").length')==0)
        await scenario('Profile editor account isolation',editor_session)

        async def new_profile(page):
            await page.evaluate('(key)=>{__events=__events.filter(e=>!(e.kind===0&&e.pubkey===key));}',alice)
            await login(page);await nav(page,f'#/profile/{alice}/posts','.profile-tabs')
            await page.get_by_role('button',name='プロフィールを編集',exact=True).click()
            await page.wait_for_function('!!document.querySelector("dialog[data-profile-editor]")||!!document.querySelector(".toast.error")')
            exists=await page.locator('dialog[data-profile-editor]').count()==1
            if not check('A new account without a kind:0 event can open its profile editor',exists):return
            await page.get_by_label('ユーザー名',exact=True).fill('first-profile')
            await page.get_by_label('表示名',exact=True).fill('初めてのプロフィール')
            await page.get_by_role('button',name='保存する',exact=True).click();await page.wait_for_selector('dialog[data-profile-editor]',state='detached')
            check('A new account can publish its first valid kind:0 event',await page.evaluate('__messages.filter(m=>m[0]==="EVENT"&&m[1].kind===0).length')==1)
        await scenario('First profile creation',new_profile)

        async def thread_failure(page):
            await login(page)
            reply=next(e for e in data['events'] if e['kind']==1 and any(t[0]=='e' and len(t)>3 and t[3] in ('root','reply') for t in e['tags']))
            await nav(page,f'#/thread/{reply["id"]}','button:text-is("投稿を取得")')
            await page.get_by_role('button',name='投稿を取得',exact=True).click();await page.wait_for_selector('.thread-focus')
            await page.locator('.composer textarea').fill('消してはいけない返信の下書き')
            await page.evaluate("""()=>{const original=__app.repo.profiles.bind(__app.repo);let calls=0;__app.repo.profiles=async(...args)=>{if(++calls===2)throw Error('injected parent metadata failure');return original(...args);};}""")
            await page.get_by_role('button',name='投稿を取得',exact=True).click();await page.wait_for_selector('.toast.error')
            check('Parent lookup failure preserves the existing thread body',await page.locator('.thread-focus').count()==1)
            check('Parent lookup failure preserves the reply composer and unsent text',await page.locator('.composer textarea').count()==1 and await page.locator('.composer textarea').input_value()=='消してはいけない返信の下書き')
            check('Thread read remains manually retryable after failure',not await page.get_by_role('button',name='投稿を取得',exact=True).is_disabled())
        await scenario('Transactional thread refresh',thread_failure)

        async def history(page):
            await nav(page,f'#/profile/{alice}/posts','.profile-tabs')
            await page.locator('.profile-tabs a').filter(has_text='フォロー').first.click();await page.wait_for_selector('button:text-is("フォローを取得")')
            await page.locator('#back-button').click();await page.wait_for_timeout(100)
            check('Back follows ordinary profile-tab anchor navigation',await page.evaluate('__testLocation.hash')==f'#/profile/{alice}/posts')
            check('Back navigation still starts no automatic relay requests',await page.evaluate('__messages.filter(m=>m[0]==="REQ").length')==0)
        await scenario('Anchor navigation history',history)

        async def profile_noop(page):
            await login(page);await nav(page,f'#/profile/{alice}/posts','.profile-tabs')
            await page.get_by_role('button',name='プロフィールを編集',exact=True).click();await page.wait_for_selector('dialog[data-profile-editor]')
            await page.get_by_role('button',name='保存する',exact=True).click();await page.wait_for_selector('dialog[data-profile-editor]',state='detached')
            check('Saving an unchanged profile does not sign or publish an unnecessary event',await page.evaluate('__messages.filter(m=>m[0]==="EVENT").length')==0)
        await scenario('No-op profile edit',profile_noop)

        async def settings_rejection(page):
            await nav(page,'#/settings','.settings-form')
            before=await page.evaluate('JSON.stringify(__app.settings.value)')
            await page.locator('input[type=file]').set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':b'{"loadImages":"false"}'})
            await page.wait_for_selector('.toast')
            check('Malformed imported settings produce an explicit error instead of truthy coercion',await page.locator('.toast.error').count()>0)
            check('Rejected settings import leaves active values unchanged',await page.evaluate('JSON.stringify(__app.settings.value)')==before)
            check('Rejected settings import leaves the settings form usable',await page.locator('.settings-form').count()==1)
        await scenario('Settings import rejection',settings_rejection)

        async def logout_after_failure(page):
            await login(page)
            await page.evaluate("""async()=>{const old=__app.social.loadAccount;__app.social.loadAccount=async()=>{throw Error('injected account read failure');};await __app.ensureAccount().catch(()=>{});__app.social.loadAccount=old;__app.session.logout();}""")
            await page.wait_for_selector('#account button');await page.wait_for_selector('.feed-toolbar')
            await page.get_by_role('button',name='最新を読み込む',exact=True).click();await page.wait_for_function('__app.activeFeed&&!__app.activeFeed.operation')
            check('A failed account read does not poison anonymous reads after logout',await page.locator('.timeline>.post').count()>0)
            check('Anonymous recovery still performs no signing',await page.evaluate('__messages.filter(m=>m[0]==="EVENT").length')==0)
        await scenario('Logout after failed account read',logout_after_failure)

        async def follower_refresh(page):
            await nav(page,f'#/profile/{alice}/followers','button:text-is("フォロワーを取得")')
            await page.get_by_role('button',name='フォロワーを取得',exact=True).click()
            await page.wait_for_function('document.querySelectorAll(".user-row").length===2&&!document.querySelector(".profile-tab-content[aria-busy]")')
            previous=await page.locator('.user-row').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.pubkey).sort()')
            await page.evaluate("""()=>{window.__query=__app.network.query.bind(__app.network);__app.network.query=async()=>({events:[],complete:false,errors:[{relay:'ws://127.0.0.1:9876/',reason:'injected offline refresh'}]});}""")
            await page.get_by_role('button',name='フォロワーを更新',exact=True).click()
            await page.wait_for_function('!document.querySelector(".profile-tab-content[aria-busy]")')
            check('All-relay failure during follower refresh preserves every previously shown identity',await page.locator('.user-row').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.pubkey).sort()')==previous)
            check('Failed follower refresh remains explicitly retryable',not await page.get_by_role('button',name='フォロワーを更新',exact=True).is_disabled())
            await page.evaluate('()=>{__app.network.query=__query;}')
            await page.get_by_role('button',name='フォロワーを更新',exact=True).click()
            await page.wait_for_function('!document.querySelector(".profile-tab-content[aria-busy]")')
            check('Follower refresh recovers after the user explicitly retries',await page.locator('.user-row').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.pubkey).sort()')==previous)
        await scenario('Follower refresh atomicity',follower_refresh)

        async def safe_text(page):
            injected=sign(dict(kind=1,content='<img src=x onerror="window.__injected=1"> & test',tags=[],created_at=int(__import__('time').time())-1))
            await page.evaluate('(e)=>__events.push(e)',injected)
            await page.get_by_role('button',name='最新を読み込む',exact=True).click();await page.wait_for_function('__app.activeFeed&&!__app.activeFeed.operation')
            check('Untrusted note HTML is rendered literally',await page.locator('.post-text').filter(has_text='<img src=x').count()==1)
            check('Untrusted note content cannot create executable DOM',await page.evaluate('!window.__injected&&document.querySelectorAll(".post-text img").length===0'))
            count=await page.evaluate('__messages.filter(m=>m[0]==="REQ").length');await page.evaluate('scrollTo(0,1400)');await page.wait_for_timeout(150)
            check('Scrolling remains network-silent after the audit fixes',await page.evaluate('__messages.filter(m=>m[0]==="REQ").length')==count)
            check('An explicit latest read still displays at most thirty posts',await page.locator('.timeline>.post').count()<=30)
            check('Completed subscriptions still have one CLOSE each',await page.evaluate('__messages.filter(m=>m[0]==="REQ").length===__messages.filter(m=>m[0]==="CLOSE").length'))
        await scenario('Rendering and manual-fetch invariants',safe_text)
        await context.close();await browser.close()
    result={'suite':'cross-feature-audit','checks':checks,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'boundaries':'Mock relay/NIP-07/storage/navigation/SHA adapter; real Chromium DOM and ES modules.'}
    (OUT/'audit-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(f"RESULT: {result['passed']} passed; {result['failed']} failed",flush=True)
    if result['failed']:raise SystemExit(1)

if __name__=='__main__':asyncio.run(main())
