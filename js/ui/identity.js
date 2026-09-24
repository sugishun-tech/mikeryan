import { el, avatar, icon, button, busy } from './dom.js?v=1.1.0';
import { profileHref } from '../core/router.js?v=1.1.0';
import { shortKey } from '../core/utils.js?v=1.1.0';
import { pubkeys } from '../social/service.js?v=1.1.0';
/** The same identity renderer is used by posts, notifications and profile lists. */
export class Identity {
  constructor(app){this.app=app;this.observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const node=entry.target;this.observer.unobserve(node);node._hydrate?.();}},{rootMargin:'120px'});}
  reset(){this.observer.disconnect();}
  mount(pubkey,{large=false,handle=true}={}){
    const {repo,settings,nip05}=this.app;
    const wrap=el('span',{class:'identity',dataset:{pubkey}}),name=el('span',{class:large?'display-name':'user-name'},shortKey(pubkey));
    const badge=el('span',{class:'nip05-badge'}),identifier=el('span',{class:'user-handle'});
    wrap.append(el('span',{class:'name-line'},name,badge));if(handle)wrap.append(identifier);
    const paint=profile=>{name.textContent=String(profile.display_name||profile.name||shortKey(pubkey));identifier.textContent=profile.name?'@'+profile.name:shortKey(pubkey);};paint(repo.peekProfile(pubkey));
    wrap._hydrate=async()=>{
      const profile=repo.peekProfile(pubkey);if(!wrap.isConnected)return;paint(profile);
      if(settings.value.verifyNip05 && typeof profile.nip05==='string'&&profile.nip05){
        badge.textContent='';badge.title=`${profile.nip05} · 検証中`;badge.className='nip05-badge pending';
        const status=await nip05.verify(profile.nip05,pubkey);if(!wrap.isConnected)return;
        badge.className=`nip05-badge ${status.state}`;badge.title=`${profile.nip05} · ${status.reason}`;badge.setAttribute('aria-label',badge.title);badge.replaceChildren();
        if(status.state==='valid')badge.append(icon('check',14));else if(status.state==='invalid')badge.textContent='!';else badge.textContent='?';
      }
    };
    this.observer.observe(wrap);return wrap;
  }
  userRow(pubkey,{mutual=false,owner=null}={}){
    const app=this.app,p=app.repo.peekProfile(pubkey);
    const row=el('div',{class:'user-row',dataset:{pubkey}});
    const info=el('a',{href:profileHref(pubkey),class:'user-row-link'},avatar(p,'avatar',app.settings.value.loadImages),el('div',{class:'user-row-info'},this.mount(pubkey),owner?el('span',{class:'mutual',hidden:!mutual,dataset:{mutual:pubkey,owner}},'相互フォロー'):null));row.append(info);
    const about=String(p.about??'').replace(/\n/g,' ').slice(0,90);if(about)info.lastChild.append(el('p',{class:'user-row-about'},about));
    if(app.session.pubkey&&pubkey!==app.session.pubkey)row.append(this.followButton(pubkey));return row;
  }
  followButton(pubkey){
    const app=this.app;const b=button('',async()=>busy(b,()=>app.social.toggleFollow(pubkey)),'button follow-button',{dataset:{follow:pubkey}});
    this.paintFollow(b,pubkey);return b;
  }
  paintFollow(b,pubkey){const following=this.app.social.following.has(pubkey);b.textContent=following?'フォロー中':'フォロー';b.classList.toggle('following',following);b.setAttribute('aria-pressed',String(following));b.disabled=this.app.social.pending.has(`follow:${pubkey}`);b.title=following?'クリックしてフォローを解除':'フォローする';}
  updateFollows(){
    for(const b of document.querySelectorAll('[data-follow]'))this.paintFollow(b,b.dataset.follow);
    for(const badge of document.querySelectorAll('[data-mutual]')){
      const {owner,mutual:key}=badge.dataset;
      const a=this.app.repo.replacements.get(`3:${owner}`),b=this.app.repo.replacements.get(`3:${key}`);
      if(a&&b)badge.hidden=!(pubkeys(a).includes(key)&&pubkeys(b).includes(owner));
    }
  }
}
