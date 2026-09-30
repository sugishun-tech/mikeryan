import { el, button } from './dom.js?v=1.3.2';
import { ContentResolver } from '../content/resolver.js?v=1.3.2';
import { CONTENT_LIMITS, referenceHref, referenceURI } from '../content/references.js?v=1.3.2';
import { threadHref } from '../core/router.js?v=1.3.2';

let serial=0;
const readMessage=data=>{
  if (typeof data==='string') { if (data.length>8192) return null; try { return JSON.parse(data); } catch { return null; } }
  return data && typeof data==='object' ? data : null;
};

/** Every embed has its own error boundary, deadline and lifecycle cleanup.
 * External scripts NEVER run in the NIP-07 / account document.
 */
export class Embeds {
  constructor(app, renderPost, {timeout=CONTENT_LIMITS.timeout}={}) {
    this.app=app; this.renderPost=renderPost; this.timeout=timeout;
    this.resolver=new ContentResolver(app.repo); this.jobs=new Set(); this.owners=new Map();
    this.observer=new IntersectionObserver(entries=>{
      for (const entry of entries) if (entry.isIntersecting) {
        this.observer.unobserve(entry.target); entry.target._startEmbed?.();
      }
    },{rootMargin:'200px'});
    this.removals=new MutationObserver(()=>{
      for (const job of this.jobs) if (!job.host.isConnected) job.cancel();
      for (const [key,host] of this.owners) if (!host.isConnected) this.owners.delete(key);
    });
    this.removals.observe(document.body,{childList:true,subtree:true});
  }
  reset() {
    this.observer.disconnect();
    for (const job of [...this.jobs]) job.cancel();
    this.owners.clear(); this.resolver.reset();
  }
  /** Start a new explicit read. Pending requests remain coalesced by Repository. */
  beginRead() { this.resolver.reset(); }
  mount(embed,{ancestors=new Set(),notification=false}={}) {
    const host=el('div',{class:`content-embed embed-${embed.type}`,dataset:{embed:embed.type,state:'pending'}});
    const visual=el('div',{class:'embed-content'}),status=el('span',{class:'embed-status',role:'status'},'読み込み中…');
    const ref=embed.reference;
    const href=ref ? referenceHref(ref) : embed.href || (embed.event ? threadHref(embed.event.id) : '');
    const label=ref ? ref.uri || referenceURI(ref) : embed.raw || embed.href || 'リポストのイベントを開く';
    const linkText=ref ? (ref.type==='profile'?'プロフィールを開く':'参照先の投稿を開く') : ({image:'画像を開く',youtube:'YouTubeで動画を開く'}[embed.type] || label);
    const link=href ? el('a',{class:'embed-source',href,title:label,...(!href.startsWith('#')?{target:'_blank',rel:'noopener noreferrer nofollow'}:{})},linkText) : null;
    const footer=el('div',{class:'embed-footer'},status,link);
    host.append(visual,footer);
    const cleanups=[]; let stopped=false, started=false, timer=null;
    const job={host,cancel:()=>{
      if (stopped) return; stopped=true;
      clearTimeout(timer); this.observer.unobserve(host); delete host._startEmbed;
      for (const clean of cleanups.splice(0)) { try { clean(); } catch { /* Best-effort detached frame cleanup. */ } }
      this.jobs.delete(job);
    }};
    const alive=()=>!stopped && host.isConnected;
    const fail=(message='埋め込みを表示できませんでした。リンクから開いてください')=>{
      if (!alive()) { job.cancel(); return; }
      host.dataset.state='failed'; visual.replaceChildren(); status.textContent=message;
      job.cancel();
    };
    const ready=()=>{
      if (!alive()) return;
      clearTimeout(timer);host.dataset.state='ready';status.textContent='';
    };
    const listen=(target,type,handler)=>{target.addEventListener(type,handler);cleanups.push(()=>target.removeEventListener(type,handler));};
    const deadline=()=>{timer=setTimeout(()=>fail(),this.timeout);};
    const externalKey=embed.id ? `${embed.type}:${embed.id}` : embed.type==='image' ? 'image:'+embed.href : null;
    const start=async()=>{
      if (started||!alive()) return; started=true;
      if (externalKey) {
        const owner=this.owners.get(externalKey);
        if (owner && owner!==host && owner.isConnected) { fail('同じコンテンツの重複読み込みを省略しました'); return; }
        this.owners.set(externalKey,host);
      }
      try {
        if (embed.type==='nostr' || embed.type==='repost') {
          deadline();
          const result=await (embed.type==='repost' ? this.resolver.repost(embed.event) : this.resolver.resolve(ref));
          if (!alive()) return;
          if (!result) { fail('投稿を取得できませんでした。リンクから開いてください'); return; }
          if (result.type==='profile') {
            if (this.app.moderation?.pubkeyMuted(result.pubkey)) { fail('ミュート中のプロフィールです'); return; }
            visual.append(this.app.identity.userRow(result.pubkey));
          } else {
            if (ancestors.has(result.id)) { fail('循環参照のため埋め込みを省略しました'); return; }
            if (this.app.moderation?.pubkeyMuted(result.pubkey)) { fail('ミュート中の投稿です'); return; }
            // An author's metadata failure never discards the signed post itself.
            try { await this.app.repo.profiles([result.pubkey]); } catch { /* Show hex identity if unavailable. */ }
            if (!alive()) return;
            if (this.app.moderation?.muted(result,this.app.repo.peekProfile(result.pubkey),{notification})) { fail('表示・ミュート条件により元の投稿を非表示にしました'); return; }
            visual.append(this.renderPost(result,{depth:1,embedded:true,ancestors,notification}));
            if (embed.type==='repost' && link) { link.href=threadHref(result.id);link.textContent='元の投稿を開く'; }
          }
          ready();job.cancel();return;
        }
        if (embed.type==='image') {
          const image=el('img',{class:'post-image',alt:embed.alt||'投稿に添付された画像',loading:'lazy',decoding:'async',referrerPolicy:'no-referrer',
            ...(embed.width && embed.height ? {width:embed.width,height:embed.height} : {})});
          const anchor=el('a',{href:embed.href,target:'_blank',rel:'noopener noreferrer',class:'post-image-link'},image);
          listen(image,'error',()=>fail('画像を読み込めませんでした。リンクから開いてください'));
          listen(image,'load',()=>{ready();job.cancel();});
          visual.append(anchor);image.src=embed.href;deadline();
          if (image.complete && image.naturalWidth) { ready();job.cancel(); }
          return;
        }
        if (embed.type==='youtube') {
          const origin='https://www.youtube-nocookie.com';
          const url=new URL(`/embed/${embed.id}`,origin);
          url.searchParams.set('enablejsapi','1'); url.searchParams.set('playsinline','1');
          // YouTube requires an HTTP Referer/client identity. Send only the origin.
          const pageOrigin=new URL(location.href).origin;
          if (/^https?:\/\//.test(pageOrigin)) url.searchParams.set('origin',pageOrigin);
          const frame=el('iframe',{class:'external-player youtube-player',title:'YouTube 動画プレイヤー',allow:'fullscreen; encrypted-media; picture-in-picture',allowFullscreen:true,referrerPolicy:'strict-origin-when-cross-origin'});
          frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');
          const token='mikeryan-yt-'+(++serial); let attempts=0,interval;
          const send=(event,func,args)=>frame.contentWindow?.postMessage(JSON.stringify({event,id:token,channel:'widget',...(func?{func,args}:{})}),origin);
          const handshake=()=>{
            if (!alive() || ++attempts>20) { clearInterval(interval);return; }
            send('listening');send('command','addEventListener',['onReady']);send('command','addEventListener',['onError']);
          };
          listen(window,'message',event=>{
            if (!alive() || event.source!==frame.contentWindow || event.origin!==origin) return;
            const data=readMessage(event.data);
            if (data?.event==='onReady') { clearInterval(interval);ready(); }
            else if (data?.event==='onError') fail('動画を埋め込めませんでした。YouTubeで開いてください');
          });
          listen(frame,'error',()=>fail());listen(frame,'load',handshake);
          // This is a finite postMessage handshake, NOT network polling. If the
          // provider changes its protocol, the deadline leaves a normal link.
          interval=setInterval(handshake,500);cleanups.push(()=>clearInterval(interval));
          listen(document,'securitypolicyviolation',event=>{if (event.violatedDirective?.startsWith('frame-src') && event.blockedURI?.startsWith(origin)) fail();});
          visual.append(frame);frame.src=url.href;deadline();
          cleanups.push(()=>{frame.removeAttribute('src');frame.remove();});
        }
        const close=button('埋め込みを閉じる',()=>fail('リンクから開いてください'),'text-button embed-close');footer.append(close);
        cleanups.push(()=>close.remove());
      } catch { fail(); }
    };
    this.jobs.add(job);
    host._startEmbed=()=>void start();
    // Relay references are part of the explicit feed/read action, NOT scrolling.
    // Only media loading waits for visibility, and images also carry loading=lazy.
    if (embed.type==='nostr'||embed.type==='repost') queueMicrotask(()=>void start());
    else this.observer.observe(host);
    return host;
  }
}
