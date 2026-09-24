"""1.2.0 native-API integration check for a normal browser environment.
Uses actual localhost HTTP/WebSockets/IndexedDB/modules/SharedWorker. NIP-05 HTTP
and the NIP-07 signer use public test fixtures. Not a public-relay or extension test.
Run: CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
A navigation-policy error is a failure, never a skipped/pass result.
"""
import asyncio
import functools
import json
import os
import shutil
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import websockets
from playwright.async_api import async_playwright
from fixture_signer import fixtures, sign

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/output'

class HTTPHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def matches(event, filt):
    for field in ('kinds', 'authors', 'ids'):
        attr = {'kinds':'kind', 'authors':'pubkey', 'ids':'id'}[field]
        if field in filt and event[attr] not in filt[field]:
            return False
    if event['created_at'] < filt.get('since', 0) or event['created_at'] > filt.get('until', 2**53):
        return False
    return all(not key.startswith('#') or any(tag[0] == key[1:] and len(tag) > 1 and tag[1] in value
               for tag in event['tags']) for key, value in filt.items())

async def main():
    OUT.mkdir(exist_ok=True)
    result_path = OUT/'native-persistence-results.json'
    result_path.unlink(missing_ok=True)
    data = fixtures()
    events, logs, connections, errors, checks = list(data['events']), [], [], [], []
    http_count = 0
    def requests():
        return [message for message in logs if message[0] == 'REQ']
    def ok(name, condition=True):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
        print('PASS:', name, flush=True)
    async def relay(ws):
        connections.append(ws)
        async for raw in ws:
            message = json.loads(raw)
            logs.append(message)
            if message[0] == 'REQ':
                selected = {}
                for filt in message[2:]:
                    matched = sorted((e for e in events if matches(e, filt)), key=lambda e:(-e['created_at'], e['id']))
                    for event in matched[:filt.get('limit', 30)]:
                        selected[event['id']] = event
                for event in selected.values():
                    await ws.send(json.dumps(['EVENT', message[1], event]))
                await ws.send(json.dumps(['EOSE', message[1]]))
            elif message[0] == 'EVENT':
                events.append(message[1])
                await ws.send(json.dumps(['OK', message[1]['id'], True, '']))

    http = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(HTTPHandler, directory=str(ROOT.parent)))
    threading.Thread(target=http.serve_forever, daemon=True).start()
    try:
        async with websockets.serve(relay, '127.0.0.1', 0) as ws_server, async_playwright() as p:
            port = ws_server.sockets[0].getsockname()[1]
            url = f'http://127.0.0.1:{http.server_port}/{ROOT.name}/'
            settings = dict(relays=[f'ws://127.0.0.1:{port}/'], readRelayCount=1, requestGapMs=800,
                batchSize=30, muteContentPatterns=[], muteDisplayNamePatterns=[], mutedPubkeys=[],
                hideIncompleteProfiles=False, loadImages=False, verifyNip05=True, theme='light')
            browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
                                               headless=True, args=['--no-sandbox'])
            context = await browser.new_context(viewport={'width':1440, 'height':1000}, locale='ja-JP')
            context.set_default_timeout(20000)
            await context.expose_function('testGetPublicKey', lambda: data['keys']['alice'])
            await context.expose_function('testSignEvent', lambda template: sign(template))
            await context.add_init_script('window.nostr={getPublicKey:()=>testGetPublicKey(),signEvent:e=>testSignEvent(e)};')
            await context.route('**/default.json', lambda route: route.fulfill(json=settings))
            async def nip05(route):
                nonlocal http_count
                http_count += 1
                await route.fulfill(json={'names':{'alice':data['keys']['alice'], 'bob':data['keys']['bob']}},
                                    headers={'access-control-allow-origin':'*'})
            await context.route('https://**/.well-known/nostr.json?*', nip05)
            external = []
            async def guard(route):
                target = route.request.url
                if target.startswith('http://127.0.0.1:') or '/.well-known/nostr.json?' in target:
                    await route.fallback()
                else:
                    external.append(target)
                    await route.abort()
            await context.route('**/*', guard)
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(url)
            await page.wait_for_selector('.feed-toolbar')
            await page.wait_for_timeout(300)
            ok('Native initial access: no relay connection, REQ or NIP-05 HTTP', not connections and not requests() and http_count == 0)
            async def read(target):
                await target.get_by_role('button', name='最新を読み込む', exact=True).click()
                await target.wait_for_function('''()=>{const status=document.querySelector('.feed-status');return status &&
                    !/読み込み中|まだ取得/.test(status.textContent) && [...document.querySelectorAll('.feed-toolbar button')].every(b=>!b.disabled)}''')
                await target.wait_for_selector('.timeline>.post')
                await target.wait_for_timeout(80)
            async def nav(target, route, selector):
                await target.evaluate('(hash)=>{location.hash=hash}', route)
                await target.wait_for_selector(selector)
                await target.wait_for_timeout(150)
            await read(page)
            ok('Native explicit cold anonymous read gets posts and metadata', len(requests()) == 2)
            records = await page.evaluate('''async()=>{
                const {storagePrefix}=await import('./js/core/config.js?v=1.2.0');
                return new Promise((resolve,reject)=>{const r=indexedDB.open(storagePrefix()+'profiles',1);
                  r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;
                    const tx=db.transaction('profiles','readonly'), q=tx.objectStore('profiles').getAll();
                    q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error);};});}''')
            ok('Real IndexedDB contains only kind:0 profile records', bool(records) and all(r['event']['kind'] == 0 for r in records))
            ok('Real IndexedDB persisted event-bound NIP-05 status', any(r.get('verification') and r['verification']['eventId'] == r['event']['id'] for r in records))
            n, h = len(requests()), http_count
            await page.reload()
            await page.wait_for_selector('.feed-toolbar')
            await page.wait_for_timeout(300)
            ok('Native reload is idle', len(requests()) == n and http_count == h and await page.locator('.timeline>.post').count() == 0)
            alice = data['keys']['alice']
            await nav(page, f'#/profile/{alice}/posts', '.profile-info .display-name')
            ok('Profile metadata restored from native IndexedDB without network', await page.locator('.profile-info .display-name').inner_text() == 'アリス' and len(requests()) == n and http_count == h)
            await nav(page, '#/global', '.feed-toolbar')
            await read(page)
            ok('Warm native read fetches only posts', len(requests()) == n+1 and http_count == h and requests()[-1][2]['kinds'] == [1])
            second = await context.new_page()
            second.on('pageerror', lambda error: errors.append(str(error)))
            n = len(requests())
            await second.goto(url)
            await second.wait_for_selector('.feed-toolbar')
            await read(second)
            ok('Second tab reuses native persistent profiles', len(requests()) == n+1 and http_count == h)
            worker_mode = await second.evaluate("async()=>{const {app}=await import('./js/app.js?v=1.2.0');await app.network.ready;return app.network.mode}")
            if worker_mode == 'shared-worker':
                ok('Native SharedWorker shares one connection across two tabs', len(connections) == 1)
            else:
                print('INFO: SharedWorker unavailable; per-tab fallback used. Shared connection not tested.', flush=True)
            await second.close()
            for tab, label in [('following','フォロー'),('followers','フォロワー'),('mutes','ミュート'),('relays','リレー')]:
                n, h = len(requests()), http_count
                await nav(page, f'#/profile/{alice}/{tab}', f'button:text-is("{label}を取得")')
                ok(f'{tab}: native navigation does not fetch list or metadata', len(requests()) == n and http_count == h)
                await page.get_by_role('button', name=f'{label}を取得', exact=True).click()
                await page.wait_for_selector('.relay-row' if tab == 'relays' else '.user-row')
                ok(f'{tab}: explicit list read sends a fresh REQ', len(requests()) > n)
            current = max((e for e in events if e['kind'] == 0 and e['pubkey'] == alice), key=lambda e:e['created_at'])
            profile = json.loads(current['content']); profile['display_name'] = '手動更新後'
            events.append(sign(dict(kind=0, tags=current['tags'], content=json.dumps(profile, ensure_ascii=False), created_at=max(int(time.time()), current['created_at']+1))))
            n, h = len(requests()), http_count
            await nav(page, f'#/profile/{alice}/posts', '.profile-info')
            ok('Saved profile remains frozen before explicit refresh', await page.locator('.profile-info .display-name').inner_text() == 'アリス' and len(requests()) == n)
            await page.get_by_role('button', name='プロフィールを更新', exact=True).click()
            await page.wait_for_selector('.profile-info .display-name:text-is("手動更新後")')
            ok('Refresh updates only metadata and one NIP-05 check', len(requests()) == n+1 and http_count == h+1 and await page.locator('.timeline>.post').count() == 0)
            await page.reload(); await page.wait_for_selector('.profile-info .display-name:text-is("手動更新後")')
            ok('Updated metadata survives native reload', len(requests()) == n+1 and http_count == h+1)
            ok('Every completed REQ receives a CLOSE', len(requests()) == sum(m[0] == 'CLOSE' for m in logs))
            ok('No JavaScript errors or unintended external HTTP', not errors and not external)
            result_path.write_text(json.dumps(dict(mode='Native localhost HTTP/WebSocket/IndexedDB; fake NIP-05 and signer', passed=len(checks), checks=checks, errors=errors, workerMode=worker_mode, browser=browser.version), ensure_ascii=False, indent=2)+'\n')
            await browser.close()
    finally:
        http.shutdown(); http.server_close()
    print('RESULT:', len(checks), 'checks passed')

if __name__ == '__main__':
    asyncio.run(main())
