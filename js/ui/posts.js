import { el, avatar, button, busy, icon, richText, copy } from './dom.js?v=1.3.2';
import { cleanClient, parentId, shortKey, isHex } from '../core/utils.js?v=1.3.2';
import { profileHref, threadHref } from '../core/router.js?v=1.3.2';
import { encodeKey } from '../core/nip19.js?v=1.3.2';
import { contentPlan, referenceHref, referenceURI, repostReference } from '../content/references.js?v=1.3.2';
import { Embeds } from './embeds.js?v=1.3.2';
export class Posts {
  constructor(app){this.app=app;this.embeds=new Embeds(app,(event,options)=>this.render(event,options));}
  reset(){this.embeds.reset();}
  beginRead(){this.embeds.beginRead();}
  render(event,options={}){
    try { return this.renderCard(event,options); }
    catch {
      // One malformed event must never abort the loop which renders the feed.
      return el('article',{class:'post post-unavailable',dataset:{eventId:event?.id??''}},
        el('div',{class:'post-body'},'投稿を表示できませんでした',isHex(event?.id)?el('a',{href:threadHref(event.id)},'投稿を開く'):null));
    }
  }
  renderCard(event,{thread=false,notification=false,depth=0,embedded=false,ancestors=new Set()}={}){
    const app=this.app,profile=app.repo.peekProfile(event.pubkey);
    const card=el('article',{class:`post${thread?' thread-focus':''}${embedded?' embedded-post':''}`,dataset:{eventId:event.id,pubkey:event.pubkey}});
    const branch=new Set(ancestors);branch.add(event.id);
    if(ancestors.has(event.id))return el('div',{class:'post-unavailable'},el('a',{href:threadHref(event.id)},'循環参照のためリンクで表示'));
    if([6,16].includes(event.kind)){
      card.classList.add('repost-card');
      const header=el('div',{class:'repost-header'},icon('repost',17),el('a',{href:profileHref(event.pubkey),class:'identity-link'},app.identity.mount(event.pubkey,{handle:false})),el('span',{},'がリポスト'));
      card.append(header);
      if(depth>=1){
        const reference=repostReference(event);
        card.append(el('div',{class:'post-body post-unavailable'},'これ以上の埋め込みは行いません。',el('a',{href:reference?referenceHref(reference):threadHref(event.id)},'元の投稿を開く')));
      }else card.append(this.embeds.mount(contentPlan(event).embed,{ancestors:branch,notification}));
      return card;
    }
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
      const plan=contentPlan(event,{depth,images:app.settings.value.loadImages});
      if(plan.quotes.length){
        const quotes=el('div',{class:'quote-label'},icon('reply',14),el('span',{},'引用投稿'));
        for(const reference of plan.quotes){const href=referenceHref(reference);if(href)quotes.append(el('a',{href,title:reference.uri||referenceURI(reference)},reference.type==='address'?'アドレス指定の投稿':shortKey(reference.id)));}
        body.append(quotes);
      }
      if(plan.embed)body.append(this.embeds.mount(plan.embed,{ancestors:branch,notification}));
      const client=cleanClient(event);if(client)body.append(el('div',{class:'client-label'},'via '+client));
      const actions=el('div',{class:'post-actions'});
      actions.append(el('a',{href:threadHref(event.id),class:'icon-button reply-action',title:'返信・スレッドを開く','aria-label':'返信・スレッドを開く'},icon('reply',19)));
      const heart=button('',async()=>busy(heart,()=>app.social.like(event)),'icon-button heart-action',{title:'いいね','aria-label':'いいね',dataset:{like:event.id}});heart.append(icon('heart',19));heart.classList.toggle('liked',app.social.likes.has(event.id));heart.setAttribute('aria-pressed',String(app.social.likes.has(event.id)));
      actions.append(heart,button(icon('share',18),()=>copy(new URL(threadHref(event.id),location.href).href),'icon-button',{title:'リンクをコピー','aria-label':'リンクをコピー'}),button(icon('link',18),()=>copy('nostr:'+encodeKey('note',event.id)),'icon-button',{title:'Nostr投稿IDをコピー','aria-label':'Nostr投稿IDをコピー'}));body.append(actions);
    }
    card.append(imageLink,body);
    card.addEventListener('click',e=>{if(e.target.closest('.post')!==card||e.target.closest('a,button,input,textarea,iframe,video,select')||window.getSelection()?.toString())return;app.router.go(threadHref(target||event.id));});
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
