"""End-to-end Chromium test using localhost-only relays and test-only keys.
Run: python tests/browser_smoke.py
Requires: playwright, websockets, cryptography and a Chromium executable.
No real relay, account, or GitHub deployment is contacted or changed.
"""
import asyncio
import functools
import json
import os
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import websockets
from playwright.async_api import async_playwright
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'output'
OUT.mkdir(exist_ok=True)
class HTTPHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def match(e,f):
    if 'kinds' in f and e['kind'] not in f['kinds']: return False
    if 'authors' in f and e['pubkey'] not in f['authors']: return False
    if 'ids' in f and e['id'] not in f['ids']: return False
    if 'since' in f and e['created_at']<f['since']: return False
    if 'until' in f and e['created_at']>f['until']: return False
    for k,v in f.items():
        if k.startswith('#') and not any(t[0]==k[1:] and len(t)>1 and t[1] in v for t in e['tags']):return False
    return True

async def main():
    data=fixtures(); events=list(data['events']); logs=[];connections=[];requests=[];errors=[];checks=[];key_calls=0;sign_calls=0;denied=False
    def ok(name,condition=True):
        if not condition:raise AssertionError(name)
        checks.append(name);print('PASS:',name,flush=True)
    async def relay(ws):
        connections.append(ws)
        async for raw in ws:
            m=json.loads(raw);logs.append(m)
            if m[0]=='REQ':
                requests.append(m)
                selected={}
                for f in m[2:]:
                    found=sorted((e for e in events if match(e,f)),key=lambda e:(-e['created_at'],e['id']))[:f.get('limit',30)]
                    selected.update({e['id']:e for e in found})
                for e in selected.values():await ws.send(json.dumps(['EVENT',m[1],e]))
                await ws.send(json.dumps(['EOSE',m[1]]))
            elif m[0]=='EVENT':
                events.append(m[1]);await ws.send(json.dumps(['OK',m[1]['id'],True,'']))
    http=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(HTTPHandler,directory=str(ROOT.parent)))
    threading.Thread(target=http.serve_forever,daemon=True).start()
    async with websockets.serve(relay,'127.0.0.1',0) as ws_server:
        port=ws_server.sockets[0].getsockname()[1];url=f'http://127.0.0.1:{http.server_port}/{ROOT.name}/'
        async with async_playwright() as p:
            executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
            browser=await p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            context=await browser.new_context(viewport={'width':1440,'height':1050},locale='ja-JP',timezone_id='Asia/Tokyo')
            async def getkey():
                nonlocal key_calls
                key_calls+=1;return data['keys']['alice']
            async def signevent(template):
                nonlocal sign_calls
                sign_calls+=1
                if denied:raise Exception('Denied by user (test)')
                return sign(template)
            await context.expose_function('testGetPublicKey',getkey)
            await context.expose_function('testSignEvent',signevent)
            await context.add_init_script("window.nostr={getPublicKey:()=>window.testGetPublicKey(),signEvent:e=>window.testSignEvent(e)};")
            settings={'relays':[f'ws://127.0.0.1:{port}/'],'readRelayCount':1,'requestGapMs':800,'batchSize':10,'muteContentPatterns':[],'muteDisplayNamePatterns':[],'mutedPubkeys':[],'hideIncompleteProfiles':False,'loadImages':False,'verifyNip05':True,'theme':'light'}
            await context.route('**/default.json',lambda r:r.fulfill(json=settings))
            async def nip_route(route):
                if 'offline.' in route.request.url:await route.abort();return
                await route.fulfill(json={'names':{'alice':data['keys']['alice'],'bob':data['keys']['bob']}},headers={'access-control-allow-origin':'*'})
            await context.route('https://**/.well-known/nostr.json?*',nip_route)
            # Block any accidental external network call. WebSocket connections are localhost only by settings.
            external=[]
            async def guard(route):
                u=route.request.url
                if u.startswith('http://127.0.0.1:') or '/.well-known/nostr.json?' in u:await route.fallback();return
                external.append(u);await route.abort()
            await context.route('**/*',guard)
            page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            await page.goto(url)
            await page.wait_for_selector('.post')
            await page.wait_for_selector('.post .nip05-badge.valid')
            ok('Single subpath static site boots and displays real signed fixture posts')
            ok('No secret-key login or automatic signing',key_calls==0 and sign_calls==0)
            ok('Cold global timeline fetch uses exactly two REQs (posts + batched metadata)',len(requests)==2)
            ok('All finite initial requests close at EOSE',len([m for m in logs if m[0]=='CLOSE'])==2)
            ok('Profile lists are not fetched when timeline opens',not any(3 in f.get('kinds',[]) for m in requests for f in m[2:]))
            await page.wait_for_selector(f'.post[data-pubkey="{data["keys"]["carol"]}"] .nip05-badge.invalid')
            ok('Same NIP-05 identifier on wrong pubkey gets mismatch, not blue check')
            baseline=len(requests)
            await page.locator('.post .identity-link').first.click()
            await page.wait_for_selector('.profile-tabs')
            await page.wait_for_selector('.profile-tab-content .post')
            ok('Profile is inside same GitHub Pages site',page.url.startswith(url+'#/profile/'))
            ok('Only opened profile post tab queries, not followers/mutes/relay lists',len(requests)==baseline+3)
            await page.locator('[data-view="global"]').click();await page.wait_for_selector('.post')
            ok('Returning to timeline performs a fresh read',len(requests)==baseline+5)
            second=await context.new_page();second.on('pageerror',lambda e:errors.append(str(e)))
            before=len(requests);await second.goto(url);await second.wait_for_selector('.post')
            ok('Two tabs share exactly one relay WebSocket',len(connections)==1)
            ok('Second tab requests its own fresh view without reusing completed data',len(requests)==before+2)
            await second.close()
            await page.locator('#account button').click()
            await page.wait_for_selector('#account .account-link')
            await page.wait_for_selector('.composer textarea:not([disabled])')
            await page.wait_for_selector('.post')
            ok('One login enables account UI',key_calls==1)
            await page.screenshot(path=str(OUT/'desktop.png'),full_page=False)
            await page.reload();await page.wait_for_selector('.composer textarea:not([disabled])');await page.wait_for_selector('.post')
            ok('Reload restores account without calling extension getPublicKey',key_calls==1)
            await page.locator('.composer textarea').fill('ローカルリレーでの投稿テストです。')
            await page.locator('.composer').get_by_role('button',name='ポストする',exact=True).click()
            await page.wait_for_selector('.post-text:text-is("ローカルリレーでの投稿テストです。")')
            created=next(e for e in reversed(events) if e['content']=='ローカルリレーでの投稿テストです。')
            ok('Post signed once, published once, client tag is mikeryan',sum(m[0]=='EVENT' and m[1]['id']==created['id'] for m in logs)==1 and ['client','mikeryan'] in created['tags'])
            ok('First write verifies restored extension account once',key_calls==2)
            await page.locator(f'.post[data-event-id="{created["id"]}"] .reply-action').click()
            await page.wait_for_selector('.thread-focus')
            await page.locator('.composer textarea').fill('返信のテストです。')
            await page.get_by_role('button',name='返信する',exact=True).click()
            await page.wait_for_selector('.post-text:text-is("返信のテストです。")')
            reply=next(e for e in reversed(events) if e['content']=='返信のテストです。')
            ok('Reply preserves NIP-10 root relationship',any(t[:4]==['e',created['id'],'','root'] for t in reply['tags']))
            heart=page.locator(f'.thread-focus [data-like="{created["id"]}"]');await heart.click();await page.wait_for_function('(id)=>document.querySelector(`[data-like="${id}"]`).classList.contains("liked")',arg=created['id'])
            previous=sign_calls;await heart.click();await page.wait_for_timeout(200)
            ok('Like cannot accidentally create duplicate signed reactions',sign_calls==previous)
            # Own following page: mutual badge updates immediately without navigation.
            await page.goto(url+f'#/profile/{data["keys"]["alice"]}/following')
            await page.wait_for_selector('.user-row .mutual:not([hidden])')
            follow=page.locator(f'[data-follow="{data["keys"]["bob"]}"]')
            await follow.click();await page.wait_for_function('(key)=>document.querySelector(`[data-follow="${key}"]`).textContent==="フォロー"',arg=data['keys']['bob'])
            ok('Follow toggle does not navigate and mutual badge disappears',await page.locator('.user-row .mutual:not([hidden])').count()==0)
            contact=next(e for e in reversed(events) if e['kind']==3 and e['pubkey']==data['keys']['alice'])
            ok('Follow list update preserves unrelated tags and legacy relay JSON',['x','preserve-me'] in contact['tags'] and 'wss://example.com' in contact['content'])
            await follow.click();await page.wait_for_selector('.user-row .mutual:not([hidden])')
            ok('Re-follow restores mutual badge in place')
            await page.locator('.profile-tabs').get_by_text('フォロワー',exact=True).click();await page.wait_for_selector('.user-row')
            ok('Stale follower candidate excluded after checking latest kind 3',await page.locator(f'.user-row[data-pubkey="{data["keys"]["carol"]}"]').count()==0)
            await page.locator('.profile-tabs').get_by_text('ミュート',exact=True).click();await page.wait_for_selector('.user-row')
            ok('Public mute list preserved',await page.locator(f'.user-row[data-pubkey="{data["keys"]["carol"]}"]').count()==1)
            before_connections=len(connections)
            await page.locator('.profile-tabs').get_by_text('リレー',exact=True).click();await page.wait_for_selector('.relay-row')
            ok('NIP-65 relays display without connecting to listed remote relays',len(connections)==before_connections and await page.locator('.relay-row').count()==2)
            await page.get_by_role('button',name='プロフィールを編集',exact=True).click();await page.get_by_label('表示名',exact=True).fill('アリス テスト更新')
            await page.get_by_role('button',name='保存する',exact=True).click();await page.wait_for_selector('dialog',state='detached')
            profile=next(e for e in reversed(events) if e['kind']==0 and e['pubkey']==data['keys']['alice'])
            ok('Profile editing preserves unrecognized metadata fields',json.loads(profile['content'])['custom_field']=={'preserved':True})
            await page.locator('[data-view="notifications"]').click();await page.wait_for_selector('.post')
            ok('Notifications include real reaction events',await page.locator('.notification-label').count()>0)
            await page.locator('[data-view="home"]').click();await page.wait_for_selector('.composer textarea');await page.wait_for_selector('.post')
            denied=True;previous=sign_calls;await page.locator('.composer textarea').fill('署名キャンセルのテストです。');await page.locator('.composer').get_by_role('button',name='ポストする',exact=True).click();await page.wait_for_selector('.toast.error')
            ok('Cancelled signature keeps draft and is not retried',await page.locator('.composer textarea').input_value()=='署名キャンセルのテストです。' and sign_calls==previous+1)
            denied=False
            await page.locator('[data-view="settings"]').click();await page.wait_for_selector('.settings-form')
            await page.get_by_label('テーマ',exact=True).select_option('dark');await page.get_by_role('button',name='設定を保存',exact=True).click()
            ok('Settings and theme persist',await page.locator('html').get_attribute('data-theme')=='dark')
            await page.locator('[data-view="home"]').click();await page.wait_for_selector('.post');await page.locator('.composer textarea').fill('');await page.screenshot(path=str(OUT/'dark.png'),full_page=False)
            await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'mobile.png'),full_page=False)
            ok('Mobile has no horizontal page overflow',await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            await page.locator('[data-view="settings"]').click();await page.wait_for_selector('.settings-form');await page.get_by_label('テーマ',exact=True).select_option('light');await page.get_by_role('button',name='設定を保存',exact=True).click()
            await page.locator('[data-view="global"]').click();await page.wait_for_selector('.post')
            await page.set_viewport_size({'width':1440,'height':1050});await page.screenshot(path=str(OUT/'desktop-final.png'),full_page=False)
            ok('No unexpected external HTTP dependencies',not external)
            ok('No uncaught browser exceptions',not errors)
            result={'checks':checks,'passed':len(checks),'relay_connections':len(connections),'relay_requests':len(requests),'closes':sum(m[0]=='CLOSE' for m in logs),'publishes':sum(m[0]=='EVENT' for m in logs),'key_requests':key_calls,'signature_requests':sign_calls,'page_errors':errors,'unexpected_external_requests':external,'browser':browser.version}
            (OUT/'browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            await browser.close()
    http.shutdown()
    print('RESULT:',len(checks),'checks passed',flush=True)

if __name__=='__main__':asyncio.run(main())
