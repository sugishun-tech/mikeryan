import { el, avatar, button, busy, icon, richText, copy } from './dom.js?v=1.1.0';
import { cleanClient, parentId, shortKey } from '../core/utils.js?v=1.1.0';
import { profileHref, threadHref } from '../core/router.js?v=1.1.0';
import { encodeKey } from '../core/nip19.js?v=1.1.0';
export class Posts {
  constructor(app){this.app=app;}
  render(event,{thread=false,notification=false}={}){
    const app=this.app,profile=app.repo.peekProfile(event.pubkey);
    const card=el('article',{class:`post${thread?' thread-focus':''}`,dataset:{eventId:event.id,pubkey:event.pubkey}});
    const imageLink=el('a',{href:profileHref(event.pubkey),class:'avatar-link','aria-label':'プロフィールを開く'},avatar(profile,'avatar',app.settings.value.loadImages));
    const body=el('div',{class:'post-body'}),head=el('div',{class:'post-header'},el('a',{href:profileHref(event.pubkey),class:'identity-link'},app.identity.mount(event.pubkey)));
    const target=event.kind===7 ? event.tags.filter(t=>t[0]==='e').at(-1)?.[1] : event.id;
    const timestamp=new Date(event.created_at*1000);
    head.append(el('a',{href:threadHref(target||event.id),class:'post-time',title:timestamp.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})},timestamp.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'})+' '+timestamp.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})));
    body.append(head);
    if(event.kind===7){body.append(el('div',{class:'notification-label'},icon('heart',18),`リアクション ${event.content||'+'}`));if(target)body.append(this.preview(target,'対象の投稿を表示'));}
    else{
      const parent=parentId(event);if(parent&&!thread)body.append(this.preview(parent,'返信先の投稿を表示'));
      body.append(el('div',{class:'post-text'},richText(event.content)));
      const client=cleanClient(event);if(client)body.append(el('div',{class:'client-label'},'via '+client));
      const actions=el('div',{class:'post-actions'});
      actions.append(el('a',{href:threadHref(event.id),class:'icon-button reply-action',title:'返信・スレッドを開く','aria-label':'返信・スレッドを開く'},icon('reply',19)));
      const heart=button('',async()=>busy(heart,()=>app.social.like(event)),'icon-button heart-action',{title:'いいね','aria-label':'いいね',dataset:{like:event.id}});heart.append(icon('heart',19));heart.classList.toggle('liked',app.social.likes.has(event.id));heart.setAttribute('aria-pressed',String(app.social.likes.has(event.id)));
      actions.append(heart,button(icon('share',18),()=>copy(new URL(threadHref(event.id),location.href).href),'icon-button',{title:'リンクをコピー','aria-label':'リンクをコピー'}),button(icon('link',18),()=>copy('nostr:'+encodeKey('note',event.id)),'icon-button',{title:'Nostr投稿IDをコピー','aria-label':'Nostr投稿IDをコピー'}));body.append(actions);
    }
    card.append(imageLink,body);
    card.addEventListener('click',e=>{if(e.target.closest('a,button,input,textarea')||window.getSelection()?.toString())return;app.router.go(threadHref(target||event.id));});
    return card;
  }
  preview(id,label){
    const app=this.app,box=el('div',{class:'reply-preview'}),known=app.repo.events.get(id);
    if(known){box.append(el('a',{href:threadHref(id)},`${app.repo.peekProfile(known.pubkey).display_name||shortKey(known.pubkey)} · ${known.content.slice(0,100).replace(/\n/g,' ')}`));}
    else{
      const b=button(label,async()=>busy(b,async()=>{const event=await app.repo.event(id);if(!box.isConnected)return;box.replaceChildren(event?el('a',{href:threadHref(id)},event.content.slice(0,160)):el('span',{},'設定中のリレーでは見つかりませんでした'));}),'text-button');box.append(b);
    }return box;
  }
  updateLikes(){for(const b of document.querySelectorAll('[data-like]')){const on=this.app.social.likes.has(b.dataset.like);b.classList.toggle('liked',on);b.setAttribute('aria-pressed',String(on));}}
}
