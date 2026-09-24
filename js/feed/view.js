import { EventPager } from './pagination.js?v=1.2.0';
import { chunks, sortEvents } from '../core/utils.js?v=1.2.0';
import { el, button, busy, empty, avatar, toast } from '../ui/dom.js?v=1.2.0';
import { local } from '../core/storage.js?v=1.2.0';
export function composer(app,parent=null){
  const area=el('textarea',{rows:3,placeholder:parent?'返信を投稿':'いまどうしてる？',maxLength:16000,'aria-label':parent?'返信本文':'投稿本文'});
  const draftKey=`draft:${app.session.pubkey}:${parent?.id??'post'}`;area.value=local.get(draftKey)??'';
  area.addEventListener('input',()=>local.set(draftKey,area.value));
  const send=button(parent?'返信する':'ポストする',async()=>busy(send,async()=>{
    if(!app.session.pubkey){await app.login();return;}
    if(!area.value.trim())return;const event=await app.social.post(area.value,parent);area.value='';local.remove(draftKey);toast('投稿しました');app.onPosted?.(event);
  }),'button primary');
  const row=el('section',{class:'composer'},avatar(app.repo.peekProfile(app.session.pubkey),'avatar',app.settings.value.loadImages),el('div',{class:'composer-content'},area,el('div',{class:'composer-bottom'},el('span',{class:'muted-text'},'Nostr · テキスト投稿'),send)));
  if(!app.session.pubkey){area.disabled=true;area.placeholder='ログインすると投稿できます';send.textContent='ログイン';}
  return row;
}
/** Controls never subscribe on scroll. Scroll is used only to select the anchor. */
export class FeedView {
  constructor(app, host, {key, filters, notification=false, threadId=null, composerEnabled=false, moderate=true, beforeRead=null}) {
    this.app=app; this.host=host; this.key=key; this.filters=filters;
    this.notification=notification; this.threadId=threadId; this.moderate=moderate;this.beforeRead=beforeRead;
    this.dead=false; this.operation=null; this.hiddenCursors={}; this.visibleEvents=[]; this.nodes=new Map();
    this.pager=new EventPager(filters=>this.alive()?app.repo.query(filters,{retain:false}):Promise.reject(new Error('画面が変更されました')),filters,30);
    this.list=el('div',{class:'timeline'});
    this.status=el('div',{class:'feed-status',role:'status'});
    this.toolbar=el('nav',{class:'feed-toolbar','aria-label':'投稿の読み込み'});
    this.buttons={};
    for (const [direction, label, title] of [
      ['older','下に読み込む','画面内の一番下の投稿から、古い側へ最大30件'],
      ['newer','上に読み込む','画面内の一番上の投稿から、新しい側へ最大30件'],
      ['latest','最新を読み込む','現在時刻から、古い側へ最大30件']
    ]) {
      const b=button(label,()=>this.read(direction).catch(e=>toast(e.message,true)),
        'button feed-read-button',{title,'aria-label':label,dataset:{direction}});
      this.buttons[direction]=b; this.toolbar.append(b);
    }
    this.start=el('div',{class:'feed-start','aria-hidden':'true'});
    host.append(this.start,this.toolbar);
    if(composerEnabled)host.append(composer(app));
    host.append(this.status,this.list);
    app.activeFeed=this;
  }
  alive(){return !this.dead && this.host.isConnected;}
  dispose(){this.dead=true;}
  init(){this.status.textContent='まだ取得していません。読み込みボタンを押してください。';return Promise.resolve();}
  viewport() {
    const top=Math.max(56,this.toolbar.getBoundingClientRect().bottom);
    const nav=document.querySelector('.sidebar');
    const bottom=nav && getComputedStyle(nav).position==='fixed' ? nav.getBoundingClientRect().top : window.innerHeight;
    return {top,bottom};
  }
  /** Directional screen edge, not the oldest/newest event retained off-screen. */
  current(direction) {
    const {top,bottom}=this.viewport();
    const rows=[...this.list.querySelectorAll(':scope > .post')].map(node=>({node,rect:node.getBoundingClientRect()}));
    const visible=rows.filter(({rect})=>rect.bottom>top+1 && rect.top<bottom-1);
    const selected=direction==='older'?visible.at(-1):visible[0];
    if(selected)return this.pager.events.get(selected.node.dataset.eventId);
    if(rows.length){
      const nearest=rows.reduce((a,b)=>Math.abs(b.rect.top-top)<Math.abs(a.rect.top-top)?b:a);
      return this.pager.events.get(nearest.node.dataset.eventId);
    }
    const events=sortEvents([...this.pager.events.values()]);
    return direction==='older'?events.at(-1):events[0];
  }
  scrollAnchor() {
    const {top}=this.viewport();
    const node=[...this.list.querySelectorAll(':scope > .post')].find(node=>node.getBoundingClientRect().bottom>top);
    return node?{id:node.dataset.eventId,top:node.getBoundingClientRect().top}:null;
  }
  read(direction,{initial=false}={}) {
    if(this.operation)return this.operation;
    const screen=direction==='latest'?null:this.current(direction), continuation=this.hiddenCursors[direction];
    const anchor=continuation && continuation.screen===screen?.id?continuation.cursor:screen, position=this.scrollAnchor();
    this.operation=(async()=>{
      Object.values(this.buttons).forEach(b=>{b.disabled=true;});
      this.toolbar.setAttribute('aria-busy','true');this.status.textContent='読み込み中…';
      try{
        if(this.beforeRead){const filters=await this.beforeRead();if(!this.alive())return;if(filters)this.pager.baseFilters=filters;}
        const page=await this.pager.load(direction,anchor);
        if(!this.alive())return;
        await Promise.all(page.map(e=>this.app.repo.accept(e)));
        const candidates=page.filter(e=>this.candidate(e));
        const key=this.app.session.pubkey;
        const info=await this.app.repo.decorate(candidates,key);
        if(!this.alive())return;
        this.app.social.applyLikes(info.events,candidates,key);
        const reset=direction==='latest'&&(this.pager.complete||page.length>0);
        this.render({reset});
        const hidden=page.filter(e=>!this.visible(e)).length;
        if(direction==='latest')this.hiddenCursors={};
        else if(page.length&&hidden===page.length)this.hiddenCursors[direction]={screen:screen?.id,cursor:direction==='older'?page.at(-1):page[0]};
        else delete this.hiddenCursors[direction];
        this.status.textContent=[this.pager.warning,
          page.length?`${page.length}件を取得${hidden?`（${hidden}件は表示条件により非表示）`:''}`:'この範囲に投稿はありません',
          !info.complete?'投稿者情報の一部を取得できませんでした':null].filter(Boolean).join(' · ');
        if(direction==='latest'&&!initial) window.scrollTo({top:Math.max(0,window.scrollY+this.start.getBoundingClientRect().top-56),behavior:'instant'});
        else if(position){
          const node=this.nodes.get(position.id);
          if(node)window.scrollBy({top:node.getBoundingClientRect().top-position.top,behavior:'instant'});
        }
      } catch(error){if(this.alive())this.status.textContent=error.message;throw error;}
      finally{Object.values(this.buttons).forEach(b=>{b.disabled=false;});this.toolbar.removeAttribute('aria-busy');}
    })().finally(()=>{this.operation=null;});
    return this.operation;
  }
  candidate(event){return !this.moderate||(!this.app.moderation.pubkeyMuted(event.pubkey)&&(this.notification||!this.app.moderation.content.some(r=>r.test(event.content))));}
  visible(event){return this.candidate(event)&&(!this.threadId||this.app.parentId(event)===this.threadId)&&(!this.moderate||!this.app.moderation.muted(event,this.app.repo.peekProfile(event.pubkey),{notification:this.notification}));}
  render({reset=false}={}){
    if(!this.alive())return;
    if(reset){this.list.replaceChildren();this.nodes.clear();}
    this.list.querySelector('.empty-state')?.remove();
    const events=sortEvents([...this.pager.events.values()]);
    this.visibleEvents=events.filter(e=>this.visible(e));
    const ids=new Set(this.visibleEvents.map(e=>e.id));
    for(const [id,node] of this.nodes)if(!ids.has(id)){node.remove();this.nodes.delete(id);}
    // Existing cards stay mounted. Inserting above does not re-request their identities.
    let cursor=this.list.firstElementChild;
    for(const event of this.visibleEvents){
      let node=this.nodes.get(event.id);
      if(!node){node=this.app.posts.render(event,{notification:this.notification});this.nodes.set(event.id,node);}
      if(node!==cursor)this.list.insertBefore(node,cursor);else cursor=cursor.nextElementSibling;
    }
    if(!this.visibleEvents.length)this.list.append(empty(events.length?'表示できる投稿がありません':'投稿が見つかりません',events.length?'現在の表示・ミュート条件で非表示になっています。':'設定中のリレーの範囲です。'));
    this.app.posts.updateLikes();
  }
  async insert(event){
    if(!this.alive())return;
    this.pager.events.set(event.id,event);
    this.render();
  }
}
export function feedFilters(app,view){
  if(view==='global')return [{kinds:[1]}];
  if(view==='notifications')return [{kinds:[1,7],'#p':[app.session.pubkey]}];
  const authors=[...new Set([app.session.pubkey,...app.social.following])];
  return chunks(authors,100).map(group=>({kinds:[1],authors:group}));
}
