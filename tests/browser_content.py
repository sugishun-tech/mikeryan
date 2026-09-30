"""Rich-content browser regression: real DOM/native modules and link-only X/Twitter.
Public network, YouTube messages, images, relays/storage/navigation/SHA
are explicit fixtures. The URL-restricted runner cannot validate live CSP/providers.
Run: python3 tests/browser_content.py
"""
import asyncio, base64, hashlib, io, json, os, shutil, sys
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright
from browser_offline import html, MOCK
from browser_navigation import LOADER
from fixture_signer import sign
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/output'; OUT.mkdir(exist_ok=True)

ADAPTER=r'''({png})=>{
 window.__media={images:[],frames:[],mode:'ready',youtube:[]};
 const imageSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
 Object.defineProperty(HTMLImageElement.prototype,'src',{...imageSrc,set(value){
   if(String(value).startsWith('https://media.example/')){
     __media.images.push(String(value));imageSrc.set.call(this,(/missing|fail/.test(String(value)))?'data:image/png;base64,!':png);
   }else imageSrc.set.call(this,value);
 }});
 const frameSrc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
 Object.defineProperty(HTMLIFrameElement.prototype,'src',{...frameSrc,set(value){
   const u=new URL(value),frame=this,mode=__media.mode;
   __media.frames.push(String(value));
   if(u.hostname==='www.youtube-nocookie.com'){
     // No URL navigation. The fixture represents the provider's wire messages.
     frame.contentWindow.postMessage=(raw,origin)=>{
       __media.youtube.push({raw,origin});const data=JSON.parse(raw);
       if(data.event==='listening' && mode!=='hang')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{
         source:frame.contentWindow,origin:'https://www.youtube-nocookie.com',data:JSON.stringify({event:mode==='error'?'onError':'onReady',info:100})
       })),0);
     };
     setTimeout(()=>frame.dispatchEvent(new Event('load')),0);return;
   }
   frameSrc.set.call(this,value);
 }});
}'''

async def main():
 f=json.loads((ROOT/'tests/fixtures/rich-content.json').read_text());checks=[];errors=[];requests=[]
 data={'keys':f['keys'],'events':list(f['events'].values())}
 settings=dict(relays=['ws://127.0.0.1:9876/'],readRelayCount=1,requestGapMs=800,batchSize=30,
   muteContentPatterns=[],muteDisplayNamePatterns=[],mutedPubkeys=[],hideIncompleteProfiles=False,
   loadImages=True,verifyNip05=False,theme='light')
 sources={p.relative_to(ROOT).as_posix():p.read_text() for p in (ROOT/'js').rglob('*.js')}
 avatar='data:image/svg+xml;base64,'+base64.b64encode((ROOT/'assets/icons/avatar.svg').read_bytes()).decode()
 image=io.BytesIO();Image.new('RGB',(1280,720),(220,225,235)).save(image,format='PNG')
 png='data:image/png;base64,'+base64.b64encode(image.getvalue()).decode()
 def check(name,value,detail=None):
  checks.append({'name':name,'passed':bool(value),**({'detail':str(detail)} if detail else {})})
  print(('PASS: ' if value else 'FAIL: ')+name+((' '+str(detail)) if not value and detail else ''),flush=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1200,'height':1000},locale='ja-JP',timezone_id='Asia/Tokyo')
  context.set_default_timeout(5000)
  await context.expose_function('testGetKey',lambda:data['keys']['alice'])
  await context.expose_function('testSign',sign)
  await context.expose_function('testDigest',lambda a:list(hashlib.sha256(bytes(a)).digest()))
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda request:requests.append(request.url))
  await page.route('**/*',lambda route:route.abort())
  await page.set_content(html());await page.evaluate(MOCK,dict(data=data,settings=settings,saved={}))
  await page.evaluate(ADAPTER,dict(png=png))
  await page.evaluate('''()=>{window.fetch=window.__testFetch;
   Object.defineProperty(window,'SharedWorker',{value:undefined,configurable:true});
   Object.defineProperty(window,'crypto',{value:{subtle:{digest:async(alg,bytes)=>Uint8Array.from(await testDigest(Array.from(new Uint8Array(bytes)))).buffer}},configurable:true});}''')
  await page.evaluate(LOADER,dict(sources=sources,avatar=avatar,relaxGap=True))
  await page.wait_for_selector('.feed-toolbar')
  check('No relay REQ on startup, despite mixed rich-content fixtures',await page.evaluate('__messages.filter(m=>m[0]==="REQ").length')==0)
  await page.evaluate('''async f=>{window.__rich=f; await __app.repo.profiles(Object.values(f.keys));
   const stage=document.createElement('div');stage.id='rich-stage';stage.className='timeline';
   document.querySelector('#view').replaceChildren(stage);
   window.__show=({names,mode='ready',timeout=2000,ancestors=[],depth=0})=>{
     __app.posts.reset();stage.replaceChildren();__media.images=[];__media.frames=[];__media.youtube=[];__media.mode=mode;
     __app.posts.embeds.timeout=timeout;__app.repo.events.clear();__app.repo.beginView();__messages.length=0;
     for(const name of names){const event=typeof name==='string'?__rich.events[name]:name;stage.append(__app.posts.render(event,{depth,ancestors:new Set(ancestors)}));}
     scrollTo(0,0);
   };
  }''',f)
  async def show(names,**kw):
   requests.clear()
   await page.evaluate('__show',dict(names=names if isinstance(names,list) else [names],**kw))
  async def settle(state='ready'):
   await page.wait_for_function('(state)=>document.querySelector("#rich-stage .content-embed")?.dataset.state===state',arg=state)
  async def value(js):return await page.evaluate(js)
  async def count(selector):return await page.locator('#rich-stage '+selector).count()
  async def case(name,fn):
   try:await fn()
   except Exception as e:check(name+' completed',False,e)

  async def nostr():
   for name in ['note','nevent','npub','nprofile','naddr']:
    await show('ref_'+name);await settle()
    check(name+': exactly one rich slot',await count('.content-embed')==1)
    check(name+': original URI remains a clickable internal link',await count('.post-text a[href^="#/"]')>=1)
    check(name+': renders existing '+('profile' if name in ['npub','nprofile'] else 'post')+' component',await count('.user-row' if name in ['npub','nprofile'] else '.embedded-post')==1)
   check('naddr resolves latest matching identifier, not other article',await page.locator(".embedded-post .post-text").inner_text()==f["events"]["article"]["content"])
   await show('multiple');await settle()
   check('Multiple NIP-21 references remain links; one is rich',await count('.content-embed')==1 and await count('.post-text > .rich-text-window > a')>=4)
   check('Nested Nostr/image/video are links only',await count('.embedded-post .post-text a')==3 and await count('.embedded-post .content-embed')==0)
   check('Depth-two event was never requested',await page.evaluate('(id)=>!__messages.some(m=>m[0]==="REQ"&&m.slice(2).some(f=>f.ids?.includes(id)))',f['events']['deep']['id']))
   await show(['ref_note','ref_nevent']);await page.wait_for_function('document.querySelectorAll("#rich-stage [data-state=ready]").length===2')
   check('Concurrent note/nevent references share one relay ID read',await page.evaluate('(id)=>__messages.filter(m=>m[0]==="REQ"&&m.slice(2).some(f=>f.ids?.includes(id))).length',f['events']['original']['id'])==1)
   check('Unconfigured relay hints never open sockets',await value('__sockets.every(s=>s.url==="ws://127.0.0.1:9876/")'))
   await show('missing');await settle('failed');check('Missing note keeps text and ordinary link',await count('.post-text a')==1 and await count('.embed-source')==1 and await count('.embedded-post')==0)
   await show('invalidFirst');await page.wait_for_timeout(50);check('Invalid first NIP-21 does not promote the second NIP-21',await count('.content-embed')==0 and await count('.post-text a')==2)
   await show('ref_note',ancestors=[f['events']['original']['id']]);await settle('failed');check('Ancestor cycle becomes a link, without recursion',await count('.embedded-post')==0)
   await show('ref_note',depth=1);await page.wait_for_timeout(50);check('Depth-one cards do not start any embeds or relay reads',await count('.content-embed')==0 and await value('__messages.length')==0)
  await case('Nostr references',nostr)

  async def reposts():
   for name in ['repostJSON','repostEmpty','repostMalformed','repostForged','generic','genericEmpty','genericNested']:
    await show(name);await settle()
    check(name+': one original card with reposter attribution',await count('.repost-header')>=1 and await count('.content-embed')==1 and await count('.embedded-post')==1)
    if name=='repostJSON':check('Verified inline original avoids ID fetch',not await page.evaluate('(id)=>__messages.some(m=>m[0]==="REQ"&&m.slice(2).some(f=>f.ids?.includes(id)))',f['events']['original']['id']))
    if name=='repostForged':check('Forged inner content never displayed as authentic author',not await value('document.querySelector("#rich-stage").textContent.includes("偽造された内容")'))
    if name=='genericNested':check('Generic repost of repost stops at one expansion',await count('.embedded-post .content-embed')==0)
   await show('repostMissing');await settle('failed');check('Unavailable original retains repost header and target link',await count('.repost-header')==1 and await count('.embed-source')==1 and '投稿を取得できません' in await page.locator('#rich-stage').inner_text())
   for name in ['quote','quoteAddress','quoteReply']:
    await show(name);await settle();check(name+': quote is labelled and uses single rich slot',await count('.quote-label')>=1 and await count('.content-embed')==1)
    check(name+': real reply distinction',await count('.post:not(.embedded-post) > .post-body > .reply-preview')==(1 if name=='quoteReply' else 0))
  await case('Reposts and quotes',reposts)

  async def images():
   for name in ['image','imeta','images']:
    await show(name);await settle();check(name+': one lazy responsive image',await count('.post-image')==1 and await page.locator('.post-image').get_attribute('loading')=='lazy')
    check(name+': image does not exceed post width',await value('(()=>{const i=document.querySelector(".post-image");return i.width<=i.closest(".post-body").clientWidth&&i.height<=520})()'))
    if name=='imeta':check('NIP-92 metadata provides alt and dimensions',await page.locator('.post-image').get_attribute('alt')=='青空の写真' and await page.locator('.post-image').get_attribute('width')=='3000')
    if name=='images':check('Additional image URLs remain links without fetch',await count('.post-text a')==3 and await value('__media.images.length')==1)
   await show('imageFailure');await settle('failed');check('Broken image hides image but retains both source links',await count('.post-image')==0 and await count('.embed-source')==1 and await count('.post-text a')==1)
   await show(['image','image']);await page.wait_for_function('document.querySelectorAll("#rich-stage [data-state=pending]").length===0');check('Duplicate image fetched once per view',await value('__media.images.length')==1)
   await show('image');await settle();await page.screenshot(path=str(OUT/'rich-image-desktop.png'))
   for width in [390,320]:
    await page.set_viewport_size({'width':width,'height':844});await page.wait_for_timeout(60)
    check(f'Image layout has no overflow at {width}px',await value('document.documentElement.scrollWidth<=innerWidth'))
   await page.screenshot(path=str(OUT/'rich-image-mobile.png'));await page.set_viewport_size({'width':1200,'height':1000})
   # Offscreen host must not allocate a media element or attempt a remote image.
   await show([]);await page.evaluate('''()=>{const gap=document.createElement('div');gap.style.height='3000px';document.querySelector('#rich-stage').append(gap,__app.posts.render(__rich.events.image));}''');await page.wait_for_timeout(80)
   check('Offscreen images are not eagerly fetched or allocated',await value('__media.images.length')==0 and await count('.post-image')==0)
   await page.locator('#rich-stage .content-embed').scroll_into_view_if_needed();await settle();check('Image initializes when near viewport',await value('__media.images.length')==1)
  await case('Images',images)

  async def youtube():
   for name in ['youtube','youtubeWatch','youtubeShorts','youtubeMultiple']:
    await show(name);await settle();check(name+': allowed privacy-enhanced responsive player',await count('.youtube-player')==1 and await value('__media.frames[0].startsWith("https://www.youtube-nocookie.com/embed/")'))
    check(name+': link remains on successful load',await count('.embed-source')==1)
   check('Multiple videos create only one player',await value('__media.frames.length')==1 and await count('.post-text a')==2)
   check('YouTube keeps origin-only Referer for player identification',await page.locator('.youtube-player').get_attribute('referrerpolicy')=='strict-origin-when-cross-origin')
   for mode in ['error','hang']:
    await show('youtube',mode=mode,timeout=160);await settle('failed');check('YouTube '+mode+': iframe removed and ordinary links retained',await count('.youtube-player')==0 and await count('.embed-source')==1 and await count('.post-text a')==1)
   await show('youtube',mode='hang',timeout=2000);await page.wait_for_selector('.youtube-player');await page.evaluate('''()=>{const f=document.querySelector('.youtube-player');
    window.dispatchEvent(new MessageEvent('message',{source:f.contentWindow,origin:'https://attacker.example',data:{event:'onReady'}}));
    window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://www.youtube-nocookie.com',data:{event:'onReady'}}));
   }''');check('YouTube ignores wrong-origin and wrong-source readiness',await count('[data-state=pending]')==1)
   await page.evaluate('''()=>{const e=new Event('securitypolicyviolation');Object.assign(e,{violatedDirective:'frame-src',blockedURI:'https://www.youtube-nocookie.com'});document.dispatchEvent(e);}''');await settle('failed');check('CSP violation event safely downgrades the video',await count('iframe')==0)
   await show('youtube');await settle();await page.evaluate('''()=>{const frame=document.querySelector('.youtube-player');window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,origin:'https://www.youtube-nocookie.com',data:{event:'onError',info:153}}));}''');await settle('failed');check('Late YouTube error after ready falls back too',await count('iframe')==0)
   await show('youtube');await settle();await page.get_by_role('button',name='埋め込みを閉じる').click();await settle('failed');check('Player can be manually closed while keeping link',await count('iframe')==0)
  await case('YouTube',youtube)

  async def x_links():
   x_url=f['events']['x']['content'].split()[-1]
   for name in ['x','twitter','xMultiple']:
    await show(name);await page.wait_for_timeout(80)
    links=await page.locator('#rich-stage .post-text a').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("href"))')
    check(name+': original URLs remain ordinary links',links==[part for part in f['events'][name]['content'].split() if part.startswith(('https://','http://'))])
    check(name+': no rich container, placeholder or iframe',await count('.content-embed,iframe')==0)
    check(name+': no embed jobs or media initialization',await value('__app.posts.embeds.jobs.size+__media.frames.length+__media.images.length')==0)
    check(name+': no X script or request',not any('platform.x.com' in u or 'platform.twitter.com' in u or 'syndication.' in u for u in requests) and await value('!document.querySelector("script[src*=widgets],script[src*=twitter],script[src*=platform]")'))
    check(name+': external links retain tab and security attributes',await page.locator('#rich-stage .post-text a').evaluate_all('(nodes)=>nodes.every(n=>n.target==="_blank"&&n.relList.contains("noopener")&&n.relList.contains("noreferrer"))'))
   for suffix in ['/photo/1','/video/1','?s=20#reply']:
    event={**f['events']['x'],'content':x_url+suffix}
    await show([event]);await page.wait_for_timeout(40)
    check('X '+suffix+': link only',await count('.content-embed,iframe')==0 and await page.locator('#rich-stage .post-text a').get_attribute('href')==event['content'])
   await show(['x','twitter','xMultiple']);await page.wait_for_timeout(50)
   check('Multiple X posts do not allocate duplicate-media jobs',await count('.post-text a')==4 and await value('__app.posts.embeds.owners.size+__app.posts.embeds.jobs.size')==0)
   await show('x',depth=1);await page.wait_for_timeout(50)
   check('Nested X URL stays an ordinary link',await count('.post-text a')==1 and await count('.content-embed,iframe')==0)
   for name,selector in [('image','.post-image'),('youtube','.youtube-player'),('ref_note','.embedded-post'),('ref_nprofile','.user-row'),('ref_naddr','.embedded-post'),('quote','.embedded-post')]:
    event={**f['events'][name],'content':x_url+' '+f['events'][name]['content']}
    await show([event]);await settle()
    check('X before '+name+': later supported candidate owns the sole slot',await count('.content-embed')==1 and await count(selector)==1)
    check('X before '+name+': original X link retained and no X frame',await page.locator('#rich-stage .post-text a[href^="https://x.com/"]').count()==1 and not any('/assets/embeds/x.html' in u for u in await value('__media.frames')))
   event={**f['events']['x'],'tags':[['imeta','url '+x_url,'m image/png']]}
   await show([event]);await page.wait_for_timeout(50)
   check('imeta cannot force an X page to load as an image',await count('.content-embed,img.post-image,iframe')==0 and await value('__media.images.length')==0)
   for width in [390,280]:
    await page.set_viewport_size({'width':width,'height':844});await show('xMultiple');await page.wait_for_timeout(60)
    check('Ordinary X links wrap without overflow at '+str(width)+'px',await value('document.documentElement.scrollWidth<=innerWidth') and await count('.content-embed')==0)
   await page.screenshot(path=str(OUT/'x-links-mobile.png'))
   await page.set_viewport_size({'width':1200,'height':1000})
   await show('xMultiple');await page.screenshot(path=str(OUT/'x-links-desktop.png'))
  await case('X/Twitter ordinary links',x_links)

  async def mixed():
   await show('mixed');await settle();check('Mixed NIP-21/image/X/YouTube/q uses first body image only',await count('.content-embed')==1 and await count('.post-image')==1 and await count('.quote-label')==1 and await count('.post-text a')==4)
   await show('mixedNostrFirst');await settle();check('Nostr-first mixed content allocates no media or nested frames',await count('.content-embed')==1 and await count('.embedded-post')==1 and await value('__media.frames.length+__media.images.length')==0)
   await show('hostile');await page.wait_for_timeout(50);check('Hostile markup is literal; untrusted video domains and nsec are not embedded',await count('script,iframe,.content-embed')==0 and not await value('window.__pwned'))
   await show([{'id':'a'*64,'pubkey':None,'created_at':0,'kind':1,'content':None,'tags':None},'image']);await settle();check('Malformed sibling cannot prevent normal image post rendering',await count('.post-unavailable')==1 and await count('.post-image')==1)
   long={'id':'b'*64,'pubkey':f['keys']['alice'],'created_at':1790722800,'kind':1,'tags':[],'content':' '.join('https://example.org/'+str(i) for i in range(5000))}
   await show([long]);check('Thousands of links are paged to at most 128 link nodes',await count('.post-text a')==128)
   await page.get_by_role('button',name='本文の続きを表示').click();check('Long text continuation keeps links clickable without accumulating DOM',await count('.post-text a')==128 and await page.get_by_role('button',name='先頭へ').count()==1)
   await show('youtube',mode='hang');await page.wait_for_selector('.youtube-player');await page.evaluate('__app.posts.reset()');check('View reset disposes pending embed jobs and iframes',await value('__app.posts.embeds.jobs.size')==0 and await count('iframe')==0)
   await show(['repostJSON','ref_naddr','ref_nprofile']);await page.wait_for_function('document.querySelectorAll("#rich-stage [data-state=ready]").length===3');await page.screenshot(path=str(OUT/'rich-cards-desktop.png'))
   await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'rich-cards-mobile.png'));check('Repost/address/profile cards fit mobile width',await value('document.documentElement.scrollWidth<=innerWidth'))
   check('Fetched posts, images and embed results are never persisted',await value('[...__saved.keys()].every(k=>!/(event:|query:|embed:|media:)/.test(k))'))
  await case('Mixed content and bounds',mixed)
  check('No uncaught parent-page JavaScript errors',not errors,errors)
  result={'mode':'Native DOM/modules; X/Twitter ordinary links with no widget/frame. Mocked relay/storage/navigation/SHA/images/YouTube messages. Main CSP and public providers NOT exercised.',
    'browser':browser.version,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks,'errors':errors}
  (OUT/'content-browser-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  await browser.close()
 print('RESULT:',result['passed'],'passed,',result['failed'],'failed',flush=True)
 if result['failed']:sys.exit(1)
if __name__=='__main__':asyncio.run(main())
