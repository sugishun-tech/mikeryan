"""Notification-only NIP-25 replies with native Chromium DOM/storage/Web Locks.
Only local HTTP/WebSocket servers and deterministic public example signing keys.
Run: python3 tests/browser_reaction_replies.py
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

class QuietHTTP(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def matches(event, filt):
    for name, field in [('kinds', 'kind'), ('authors', 'pubkey'), ('ids', 'id')]:
        if name in filt and event[field] not in filt[name]:
            return False
    if not filt.get('since', 0) <= event['created_at'] <= filt.get('until', 2**53):
        return False
    return all(not key.startswith('#') or any(len(tag)>1 and tag[0] == key[1:] and tag[1] in value
               for tag in event['tags']) for key, value in filt.items())

async def main():
    OUT.mkdir(exist_ok=True)
    checks, errors, logs, external, signed_requests = [], [], [], [], []
    data = fixtures()
    alice, bob, dave = (data['keys'][name] for name in ['alice', 'bob', 'dave'])
    events = list(data['events'])
    original = next(e for e in events if e['id'] == data['root'])
    bob_post = next(e for e in events if e['kind'] == 1 and e['pubkey'] == bob)
    incoming = next(e for e in events if e['kind'] == 7 and e['pubkey'] == bob)
    sequence = 0
    def event(kind, content, tags, secret=4):
        nonlocal sequence
        sequence += 1
        item = sign(dict(kind=kind, content=content, tags=tags, created_at=int(time.time())-30+sequence), secret)
        events.append(item)
        return item
    emoji = event(7, '🎉', [['e', original['id']], ['p', alice]])
    existing_target = event(7, ':wave:', [['e', original['id']], ['p', alice]], 6)
    event(7, '', [['e', existing_target['id']], ['p', dave], ['k', '7']], 3)
    ancestor = event(7, '+', [['e', original['id']], ['p', alice], ['p', bob]])
    invalid = event(7, '+', [['e', original['id']], ['p', alice], ['e', 'not-an-event-id']])
    self_reaction = event(7, '+', [['e', original['id']], ['p', alice]], 3)
    spoof = event(7, '+', [['e', bob_post['id']], ['p', alice]])
    repost = event(6, json.dumps(original, ensure_ascii=False), [['e', original['id']], ['p', alice]])
    embedded = event(16, json.dumps(incoming, ensure_ascii=False), [['e', incoming['id']], ['p', alice], ['k', '7']])
    # A past context tag and a non-like emoji must not mark an unrelated target liked.
    event(7, '+', [['e', incoming['id']], ['e', bob_post['id']], ['p', bob]], 3)
    event(7, '❤️', [['e', emoji['id']], ['p', bob], ['k', '7']], 3)
    reject_publish = False
    reject_lookup = False
    def ok(name, condition=True):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
        print('PASS:', name, flush=True)
    def publications():
        return [m[1] for m in logs if m[0] == 'EVENT']
    def requests():
        return [m for m in logs if m[0] == 'REQ']
    async def relay(ws):
        async for raw in ws:
            message = json.loads(raw)
            logs.append(message)
            if message[0] == 'REQ':
                if reject_lookup and any(f.get('kinds') == [7] and f.get('authors') == [alice] for f in message[2:]):
                    await ws.send(json.dumps(['CLOSED', message[1], 'error: fixture lookup failure']))
                    continue
                selected = {}
                for filt in message[2:]:
                    found = sorted((e for e in events if matches(e, filt)), key=lambda e:(-e['created_at'], e['id']))
                    for item in found[:filt.get('limit', 30)]:
                        selected[item['id']] = item
                for item in selected.values():
                    await ws.send(json.dumps(['EVENT', message[1], item]))
                await ws.send(json.dumps(['EOSE', message[1]]))
            elif message[0] == 'EVENT':
                if not reject_publish and not any(e['id'] == message[1]['id'] for e in events):
                    events.append(message[1])
                await ws.send(json.dumps(['OK', message[1]['id'], not reject_publish, 'error: fixture rejected' if reject_publish else '']))

    http = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHTTP, directory=str(ROOT.parent)))
    threading.Thread(target=http.serve_forever, daemon=True).start()
    try:
        async with websockets.serve(relay, '127.0.0.1', 0) as relay_server, async_playwright() as p:
            relay_port = relay_server.sockets[0].getsockname()[1]
            url = f'http://127.0.0.1:{http.server_port}/{ROOT.name}/'
            settings = dict(relays=[f'ws://127.0.0.1:{relay_port}/'], readRelayCount=1, requestGapMs=800,
                batchSize=30, muteContentPatterns=[], muteDisplayNamePatterns=[], mutedPubkeys=[],
                hideIncompleteProfiles=False, loadImages=False, verifyNip05=False, theme='light')
            browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
                                             headless=True, args=['--no-sandbox'])
            context = await browser.new_context(viewport={'width':1280, 'height':960}, locale='ja-JP')
            context.set_default_timeout(25000)
            await context.expose_function('fixturePublicKey', lambda: alice)
            async def signing(template):
                signed_requests.append(template)
                return sign(template)
            await context.expose_function('fixtureSign', signing)
            await context.add_init_script('window.nostr={getPublicKey:()=>fixturePublicKey(),signEvent:e=>fixtureSign(e)};')
            await context.route('**/default.json', lambda route: route.fulfill(json=settings))
            async def guard(route):
                if route.request.url.startswith(f'http://127.0.0.1:{http.server_port}/'):
                    await route.fallback()
                else:
                    external.append(route.request.url)
                    await route.abort()
            await context.route('**/*', guard)
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(url)
            await page.locator('.feed-toolbar').wait_for()
            ok('Initial page performs no relay fetches or signing', not requests() and not signed_requests)
            await page.get_by_role('button', name='NIP-07でログイン', exact=True).click()
            await page.locator('#account .account-link').wait_for()
            async def notifications(tab):
                await tab.locator('[data-view="notifications"]').click()
                await tab.locator('.feed-toolbar').wait_for()
                await tab.get_by_role('button', name='最新', exact=True).click()
                await tab.wait_for_function("document.querySelector('.feed-toolbar') && !document.querySelector('.feed-toolbar').hasAttribute('aria-busy')")
            def heart(tab, target):
                return tab.locator(f'.timeline > .post[data-event-id="{target["id"]}"] button.heart-action')
            async def liked(tab, target):
                await tab.wait_for_function("id=>document.querySelector('.timeline > .post[data-event-id=\"'+id+'\"] button.heart-action')?.getAttribute('aria-pressed')==='true'", arg=target['id'])
            await notifications(page)
            ok('Notification reading does not automatically sign or publish', not signed_requests and not publications())
            ok('Incoming plus and emoji reactions receive a heart', await heart(page, incoming).count()==1 and await heart(page, emoji).count()==1)
            ok('An existing empty-content NIP-25 like is shown as liked', await heart(page, existing_target).get_attribute('aria-pressed')=='true')
            ok('An emoji or earlier-e context does not count as a like', await heart(page, emoji).get_attribute('aria-pressed')=='false' and await heart(page, incoming).get_attribute('aria-pressed')=='false')
            for target, label in [(ancestor, 'ancestor p'), (invalid, 'malformed last e'), (self_reaction, 'self reaction'),
                                  (repost, 'repost'), (embedded, 'embedded reaction')]:
                ok(f'No reply heart on {label}', await heart(page, target).count()==0)
            reply = {'id': data['reply']}
            ok('Replies in notifications have no like button', await heart(page, reply).count()==0)
            await heart(page, incoming).evaluate('(button)=>{button.click();button.click();}')
            await liked(page, incoming)
            sent = publications()[-1]
            ok('Double click signs and publishes one event', len(signed_requests)==1 and len(publications())==1)
            ok('Wire event is kind7 plus and references only the received reaction', sent['kind']==7 and sent['content']=='+' and
               [t[1] for t in sent['tags'] if t[0]=='e']==[incoming['id']] and
               [t[1] for t in sent['tags'] if t[0]=='p']==[bob] and ['k','7'] in sent['tags'])
            ok('Confirmed heart is red, filled and disabled', await heart(page, incoming).is_disabled() and
               await heart(page, incoming).evaluate("b=>getComputedStyle(b).color==='rgb(214, 40, 57)' && getComputedStyle(b.querySelector('svg')).fill!=='none'"))
            await page.reload()
            await page.locator('.feed-toolbar').wait_for()
            await page.get_by_role('button', name='最新', exact=True).click()
            await liked(page, incoming)
            ok('Reload restores the red heart without re-signing', len(signed_requests)==1 and await heart(page, incoming).is_disabled())
            # Explicit spoof click must not emit a valid-looking reaction for someone else's post.
            count = len(signed_requests)
            await heart(page, spoof).click()
            await page.locator('.toast.error').wait_for()
            ok('A spoofed recipient tag cannot cause a signature or publication', len(signed_requests)==count and len(publications())==1)
            await page.locator('#toasts').evaluate('(node)=>node.replaceChildren()')
            # Two tabs share actual localStorage and native Web Locks.
            target = event(7, '👍', [['e', original['id']], ['p', alice]], 6)
            await page.get_by_role('button', name='最新', exact=True).click()
            await heart(page, target).wait_for()
            second = await context.new_page()
            second.on('pageerror', lambda error: errors.append(str(error)))
            await second.goto(url+'#/notifications')
            await second.locator('.feed-toolbar').wait_for()
            await second.get_by_role('button', name='最新', exact=True).click()
            await heart(second, target).wait_for()
            before = len(signed_requests)
            await asyncio.gather(heart(page, target).evaluate('(b)=>b.click()'), heart(second, target).evaluate('(b)=>b.click()'))
            await liked(page, target)
            await liked(second, target)
            ok('Two native tabs create exactly one reply event', len(signed_requests)==before+1 and len([e for e in publications() if ['e',target['id']] == next((t[:2] for t in e['tags'] if t[0]=='e'),None)])==1)
            await second.close()
            # A rejected publish remains pending; retry reuses its signed id exactly.
            target = event(7, '✨', [['e', original['id']], ['p', alice]])
            await page.get_by_role('button', name='最新', exact=True).click()
            await heart(page, target).wait_for()
            reject_publish = True
            await heart(page, target).click()
            await page.wait_for_function("id=>document.querySelector('.post[data-event-id=\"'+id+'\"] button.heart-action')?.classList.contains('is-pending')", arg=target['id'])
            pending = publications()[-1]
            ok('A rejected send stays disabled and is not falsely red', await heart(page, target).is_disabled() and await heart(page, target).get_attribute('aria-pressed')=='false')
            await page.locator('[data-view="settings"]').click()
            retry = page.get_by_role('button', name='未達リレーへ再送', exact=True)
            await retry.wait_for()
            before = len(signed_requests)
            reject_publish = False
            # A real relay rejection starts the production cooldown: wait past
            # its initial 5 seconds plus up to 2.5 seconds of jitter before retry.
            await page.wait_for_timeout(8000)
            await retry.click()
            await page.get_by_text('未完了の送信はありません。', exact=True).wait_for()
            ok('Settings retries the identical signed event without another signature', publications()[-1] == pending and len(signed_requests)==before)
            await notifications(page)
            await liked(page, target)
            ok('Successful manual retry turns the notification heart red', await heart(page,target).get_attribute('aria-pressed')=='true')
            # Normal feed remains free of like controls and extra reaction queries.
            await page.locator('[data-view="global"]').click()
            n = len(requests())
            await page.get_by_role('button', name='最新', exact=True).click()
            await page.wait_for_function("!document.querySelector('.feed-toolbar')?.hasAttribute('aria-busy')")
            ok('Normal feed has no like buttons', await page.locator('button.heart-action').count()==0)
            ok('Normal feed issues no own-reaction state requests', not any(f.get('kinds')==[7] and f.get('authors')==[alice] for m in requests()[n:] for f in m[2:]))
            ok('No external HTTP requests or JavaScript page errors', not external and not errors)
            result = dict(mode='Native Chromium with localhost HTTP/WebSocket, native storage/Web Locks, fixture NIP-07 signer',
                          passed=len(checks),checks=checks,errors=errors,signatures=len(signed_requests),browser=browser.version)
            (OUT/'reaction-replies-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            await browser.close()
    finally:
        http.shutdown()
    print('RESULT:',len(checks),'checks passed')

if __name__ == '__main__':
    asyncio.run(main())
