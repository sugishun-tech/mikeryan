"""DOM/browser tests for environments that prohibit even localhost URL access.
The real app modules run unchanged in isolated strict-mode closures, with transport, storage, queue-delay,
SHA-256 and navigation adapters. No request is made to any URL.
This does NOT replace browser_smoke.py's actual WebSocket / SharedWorker test.
"""
import asyncio, base64, hashlib, json, os, re, shutil
from pathlib import Path
from playwright.async_api import async_playwright
from fixture_signer import fixtures, sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests'/'output';OUT.mkdir(exist_ok=True)

def bundle(entry):
    emitted=set();parts=[]
    def visit(path):
        path=path.resolve();key=path.relative_to(ROOT).as_posix()
        if key in emitted:return
        emitted.add(key);text=path.read_text();imports=[]
        def imp(m):
            target=(path.parent/m[2].split('?')[0]).resolve();visit(target);imports.append(f'const {{{m[1]}}}=__modules[{json.dumps(target.relative_to(ROOT).as_posix())}];');return ''
        text=re.sub(r'^import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"];?',imp,text,flags=re.M)
        # Queue-delay timing is covered by Node transport tests, not this UI suite.
        if key=='js/network/pool.js':text=text.replace('conn.gap = Math.max(gap, this.options.gap ?? 0);','conn.gap = 0;')
        exports=re.findall(r'export\s+(?:async\s+)?(?:const|class|function)\s+(\w+)',text)
        def export(m):exports.extend(x.strip() for x in m[1].split(','));return ''
        text=re.sub(r'export\s*\{([^}]+)\};?',export,text)
        text=re.sub(r'\bexport\s+(?=(?:const|class|function|async)\b)','',text)
        text=text.replace('import.meta.url',json.dumps('https://offline.example/mikeryan/'+key))
        if key=='js/core/config.js':text=re.sub(r"export const FALLBACK_ICON.*",'',text) if False else re.sub(r"const FALLBACK_ICON = [^;]+;",'const FALLBACK_ICON = '+json.dumps('data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/avatar.svg').read_bytes()).decode())+';',text)
        parts.append('__modules['+json.dumps(key)+']=(()=>{\n'+'\n'.join(imports)+'\n'+text+'\nreturn {'+','.join(exports)+'};})();')
    visit(ROOT/entry)
    return "(()=>{\"use strict\";const __modules={};const location=window.__testLocation,history=window.__testHistory;const fetch=window.__testFetch;const SharedWorker=undefined;const crypto={subtle:{digest:async(alg,bytes)=>Uint8Array.from(await window.testDigest(Array.from(new Uint8Array(bytes)))).buffer}};"+'\n'.join(parts)+";window.__testModules=__modules;})()"

def html():
    text=(ROOT/'index.html').read_text()
    text=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>','',text)
    text=re.sub(r'<script[^>]+>.*?</script>','',text,flags=re.S)
    text=re.sub(r'<link[^>]+>','',text)
    text=text.replace('./assets/icons/logo.svg','data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/logo.svg').read_bytes()).decode())
    css='\n'.join((ROOT/f'assets/css/{name}.css').read_text() for name in ['base','layout','components'])
    return text.replace('</head>','<style>'+css+'</style></head>')

MOCK=r'''
({data,settings,saved})=>{
 window.__events=data.events;window.__messages=[];window.__sockets=[];window.__deny=false;
 const memory=new Map(Object.entries(saved||{}));window.__saved=memory;
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)},configurable:true});
 Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});
 let hash='';const stack=[];
 const loc={search:'',href:'https://offline.example/mikeryan/',get hash(){return hash;},set hash(v){if(v===hash)return;stack.push(hash);hash=v;loc.href='https://offline.example/mikeryan/'+v;queueMicrotask(()=>window.dispatchEvent(new Event('hashchange')));},reload(){}};
 window.__testLocation=loc;window.__testHistory={back(){loc.hash=stack.pop()||'#/global';}};
 document.addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;const href=a.getAttribute('href');if(href?.startsWith('#/')){e.preventDefault();loc.hash=href;}},true);
 window.__testFetch=async(url,options)=>{url=String(url);if(url.endsWith('/default.json'))return new Response(JSON.stringify(settings));if(url.includes('/.well-known/nostr.json?')){if(url.includes('offline.example.com'))throw Error('offline');return new Response(JSON.stringify({names:{alice:data.keys.alice,bob:data.keys.bob}}));}throw Error('Unexpected test fetch: '+url);};
 const match=(e,f)=>(!f.kinds||f.kinds.includes(e.kind))&&(!f.authors||f.authors.includes(e.pubkey))&&(!f.ids||f.ids.includes(e.id))&&(f.since===undefined||e.created_at>=f.since)&&(f.until===undefined||e.created_at<=f.until)&&Object.entries(f).every(([k,v])=>!k.startsWith('#')||e.tags.some(t=>t[0]===k.slice(1)&&v.includes(t[1])));
 window.WebSocket=class {
   constructor(url){this.url=url;this.readyState=0;window.__sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
   emit(m){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(m)});}
   send(raw){const m=JSON.parse(raw);window.__messages.push(m);if(m[0]==='REQ')setTimeout(()=>{const selected=new Map();for(const f of m.slice(2)){for(const e of window.__events.filter(e=>match(e,f)).sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)).slice(0,f.limit))selected.set(e.id,e);}for(const e of selected.values())this.emit(['EVENT',m[1],e]);this.emit(['EOSE',m[1]]);},5);
   if(m[0]==='EVENT')queueMicrotask(()=>{window.__events.push(m[1]);this.emit(['OK',m[1].id,true,'']);});}
   close(){this.readyState=3;this.onclose?.();}
 };
 window.nostr={getPublicKey:()=>window.testGetKey(),signEvent:e=>{if(window.__deny)return Promise.reject(Error('Denied by user (test)'));return window.testSign(e);}};
}
'''
async def main():
    data=fixtures();checks=[];errors=[];key_calls=0;sign_calls=0
    def ok(name,value=True):
        if not value:raise AssertionError(name)
        checks.append(name);print('PASS:',name,flush=True)
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':1440,'height':1050},locale='ja-JP',timezone_id='Asia/Tokyo')
        async def key():
            nonlocal key_calls;key_calls+=1;return data['keys']['alice']
        async def signer(e):
            nonlocal sign_calls;sign_calls+=1;return sign(e)
        await context.expose_function('testGetKey',key);await context.expose_function('testSign',signer);await context.expose_function('testDigest',lambda a:list(hashlib.sha256(bytes(a)).digest()))
        settings=dict(relays=['ws://127.0.0.1:9876/'],readRelayCount=1,requestGapMs=800,batchSize=10,muteContentPatterns=[],muteDisplayNamePatterns=[],mutedPubkeys=[],hideIncompleteProfiles=False,loadImages=False,verifyNip05=True,theme='light')
        context.set_default_timeout(6000)
        code=bundle('js/app.js')
        async def load(saved=None):
            page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));await page.route('**/*',lambda route:route.abort());await page.set_content(html());await page.evaluate(MOCK,dict(data=data,settings=settings,saved=saved));await page.evaluate(code);await page.wait_for_selector('.post');return page
        page=await load();await page.wait_for_selector('.post .nip05-badge.valid')
        ok('Renderer boots with signed Nostr events, no automatic signing',key_calls==0 and sign_calls==0)
        reqs=lambda:page.evaluate('window.__messages.filter(m=>m[0]==="REQ").length')
        ok('Cold one-relay timeline uses two REQs: posts + batched metadata',await reqs()==2)
        ok('EOSE closes both finite subscriptions',await page.evaluate('window.__messages.filter(m=>m[0]==="CLOSE").length')==2)
        await page.wait_for_selector(f'.post[data-pubkey="{data["keys"]["carol"]}"] .nip05-badge.invalid')
        ok('NIP-05 mismatch cannot reuse another author blue badge')
        await page.locator('.post .identity-link').first.click();await page.wait_for_selector('.profile-tabs');await page.wait_for_selector('.profile-tab-content .post')
        ok('Profile fetches its metadata and posts; unopened list tabs make no request',await reqs()==5)
        await page.locator('[data-view="global"]').click();await page.wait_for_selector('.post')
        ok('Returning to global performs a fresh posts + metadata read',await reqs()==7)
        await page.locator('#account button').click();await page.wait_for_selector('.composer textarea:not([disabled])');await page.wait_for_selector('.post')
        ok('One NIP-07 login enables account UI',key_calls==1)
        saved=await page.evaluate('Object.fromEntries(window.__saved)');await page.close();page=await load(saved)
        await page.wait_for_selector('.composer textarea:not([disabled])')
        ok('Saved public key restores UI without extension login',key_calls==1)
        await page.locator('.composer textarea').fill('ローカルテストでの投稿です。')
        await page.locator('.composer').get_by_role('button',name='ポストする',exact=True).click();await page.wait_for_selector('.post-text:text-is("ローカルテストでの投稿です。")')
        event=await page.evaluate('window.__events.findLast(e=>e.content==="ローカルテストでの投稿です。")')
        ok('Posting sends exactly one verified signed event with mikeryan tag',await page.evaluate('(id)=>window.__messages.filter(m=>m[0]==="EVENT"&&m[1].id===id).length',event['id'])==1 and ['client','mikeryan'] in event['tags'])
        ok('Restored signer account checked on first write only',key_calls==2)
        await page.locator(f'.post[data-event-id="{event["id"]}"] .reply-action').click();await page.wait_for_selector('.thread-focus')
        await page.locator('.composer textarea').fill('返信テストです。');await page.get_by_role('button',name='返信する',exact=True).click();await page.wait_for_selector('.post-text:text-is("返信テストです。")')
        reply=await page.evaluate('window.__events.findLast(e=>e.content==="返信テストです。")')
        ok('Thread reply carries correct root e tag',any(t[:4]==['e',event['id'],'','root'] for t in reply['tags']))
        heart=page.locator('.thread-focus .heart-action');await heart.click();await page.wait_for_selector('.thread-focus .liked');before=sign_calls;await heart.click();await page.wait_for_timeout(100)
        ok('Repeated like does not sign a duplicate',sign_calls==before)
        await page.evaluate('(key)=>window.__testLocation.hash=`#/profile/${key}/following`',data['keys']['alice']);await page.wait_for_selector('.user-row .mutual:not([hidden])')
        follow=page.locator(f'[data-follow="{data["keys"]["bob"]}"]');await follow.click();await page.wait_for_function('(key)=>document.querySelector(`[data-follow="${key}"]`).textContent==="フォロー"',arg=data['keys']['bob'])
        ok('Unfollow updates button and mutual badge without navigation',await page.locator('.user-row .mutual:not([hidden])').count()==0)
        contact=await page.evaluate('(key)=>window.__events.findLast(e=>e.kind===3&&e.pubkey===key)',data['keys']['alice'])
        ok('Follow update preserves extra tags and relay dictionary',['x','preserve-me'] in contact['tags'] and 'wss://example.com' in contact['content'])
        await follow.click();await page.wait_for_selector('.user-row .mutual:not([hidden])');ok('Re-follow updates mutual badge immediately')
        await page.locator('.profile-tabs').get_by_text('フォロワー',exact=True).click();await page.wait_for_selector('.user-row')
        ok('Followers exclude stale contact-list candidates',await page.locator(f'.user-row[data-pubkey="{data["keys"]["carol"]}"]').count()==0)
        await page.locator('.profile-tabs').get_by_text('ミュート',exact=True).click();await page.wait_for_selector('.user-row')
        ok('Public mute list displays the muted user',await page.locator(f'.user-row[data-pubkey="{data["keys"]["carol"]}"]').count()==1)
        await page.locator('.profile-tabs').get_by_text('リレー',exact=True).click();await page.wait_for_selector('.relay-row')
        ok('NIP-65 list does not connect to displayed remote relays',await page.locator('.relay-row').count()==2 and await page.evaluate('window.__sockets.length')==1)
        await page.get_by_role('button',name='プロフィールを編集',exact=True).click();await page.get_by_label('表示名',exact=True).fill('アリス 更新テスト');await page.get_by_role('button',name='保存する',exact=True).click();await page.wait_for_selector('dialog',state='detached')
        changed=await page.evaluate('(key)=>window.__events.findLast(e=>e.kind===0&&e.pubkey===key)',data['keys']['alice'])
        ok('Profile editing preserves unknown metadata',json.loads(changed['content'])['custom_field']=={'preserved':True})
        await page.locator('[data-view="notifications"]').click();await page.wait_for_selector('.post');ok('Notifications display reactions',await page.locator('.notification-label').count()>0)
        await page.locator('[data-view="home"]').click();await page.wait_for_selector('.post');await page.evaluate('window.__deny=true')
        await page.locator('.composer textarea').fill('キャンセル時に残る下書きです。');await page.locator('.composer').get_by_role('button',name='ポストする',exact=True).click();await page.wait_for_selector('.toast.error')
        ok('Denied signature preserves draft',await page.locator('.composer textarea').input_value()=='キャンセル時に残る下書きです。')
        await page.evaluate('window.__deny=false');await page.locator('.composer textarea').fill('')
        await page.locator('[data-view="settings"]').click();await page.wait_for_selector('.settings-form');await page.get_by_label('テーマ',exact=True).select_option('dark');await page.get_by_role('button',name='設定を保存',exact=True).click();ok('Theme changes to dark',await page.locator('html').get_attribute('data-theme')=='dark')
        await page.locator('[data-view="global"]').click();await page.wait_for_selector('.post');await page.evaluate('document.querySelector("#toasts").replaceChildren()');await page.screenshot(timeout=6000,animations='disabled',path=str(OUT/'dark.png'))
        await page.set_viewport_size({'width':390,'height':844});await page.evaluate('scrollTo(0,0)');await page.screenshot(timeout=6000,animations='disabled',path=str(OUT/'mobile.png'));ok('Mobile has no horizontal viewport overflow',await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        await page.locator('[data-view="settings"]').click();await page.wait_for_selector('.settings-form');await page.get_by_label('テーマ',exact=True).select_option('light');await page.get_by_role('button',name='設定を保存',exact=True).click();await page.locator('[data-view="global"]').click();await page.wait_for_selector('.post')
        await page.set_viewport_size({'width':1440,'height':1050});await page.evaluate('document.querySelector("#toasts").replaceChildren()');await page.evaluate('scrollTo(0,0)');await page.screenshot(timeout=6000,animations='disabled',path=str(OUT/'desktop.png'))
        ok('No unexpected renderer errors',not errors)
        result={'mode':'strict-mode offline DOM with transport/storage/queue-delay/navigation/SHA adapters; no real WebSocket or SharedWorker','passed':len(checks),'checks':checks,'errors':errors,'browser':browser.version}
        (OUT/'offline-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        await browser.close()
    print('RESULT:',len(checks),'offline DOM checks passed',flush=True)
if __name__=='__main__':asyncio.run(main())
