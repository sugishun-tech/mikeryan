import { EventPager } from './pagination.js';
import { TTL } from '../core/config.js';
import { chunks, stableJSON, sortEvents } from '../core/utils.js';
import { el, button, busy, empty, loading, avatar, toast } from '../ui/dom.js';
import { profileHref } from '../core/router.js';
import { local } from '../core/storage.js';
export function composer(app,parent=null){
  const area=el('textarea',{rows:3,placeholder:parent?'返信を投稿':'いまどうしてる？',maxLength:16000,'aria-label':parent?'返信本文':'投稿本文'});
  const draftKey=`draft:${app.session.pubkey}:${parent?.id??'post'}`;area.value=local.get(draftKey)??'';
  area.addEventListener('input',()=>local.set(draftKey,area.value));
  const send=button(parent?'返信する':'ポストする',async()=>busy(send,async()=>{
    if(!app.session.pubkey){await app.login();return;}
    if(!area.value.trim())return;const event=await app.social.post(area.value,parent);area.value='';local.remove(draftKey);toast('投稿しました');app.onPosted?.(event);
  }),'button primary');
  const row=el('section',{class:'composer'},avatar(app.repo.peekProfile(app.session.pubkey),'avatar',app.settings.value.loadImages),el('div',{class:'composer-content'},area,el('div',{class:'composer-bottom'},el('span',{class:'muted-text'},'Nostr · テキスト投稿'),send)));
  if(!app.session.pubkey){area.disabled=true;area.placeholder='ログインして会話に参加しましょう';send.textContent='ログイン';}
  return row;
}
export class FeedView {
  constructor(app,host,{key,filters,notification=false,threadId=null,composerEnabled=false,moderate=true}){
    this.app=app;this.host=host;this.key=`page:${stableJSON(app.repo.readRelays())}:${key}:${app.settings.value.batchSize}`;this.filters=filters;this.moderate=moderate;this.notification=notification;this.threadId=threadId;this.pager=null;
    this.list=el('div',{class:'timeline'});this.status=el('div',{class:'feed-status',role:'status'});
    const latest=button('最新',()=>busy(latest,()=>this.refresh(true)),'text-button',{title:'最新ページを取得'}),newer=button('新着を確認',()=>busy(newer,()=>this.refresh(false)),'text-button');
    this.more=button('さらに読み込む',()=>busy(this.more,()=>this.loadOlder()),'button load-more');
    const sync=button('いいね同期',()=>busy(sync,()=>app.social.loadLikes(this.visibleEvents??[])),'text-button',{title:'表示中の投稿への自分のいいねをリレーから確認（最大200件）'});
    host.append(el('div',{class:'feed-toolbar'},el('span',{class:'muted-text'},'時系列 · 自動通信なし'),el('div',{},app.session.pubkey?sync:null,newer,latest)));
    if(composerEnabled)host.append(composer(app));
    host.append(this.status,this.list,this.more);this.list.append(loading());
  }
  async init(){
    const saved=await this.app.storage.get(this.key,true);
    this.pager=new EventPager((filters,options)=>this.app.repo.query(filters,options),this.filters,this.app.settings.value.batchSize,saved?.pager);
    if(saved?.pager?.events?.length){for(const e of saved.pager.events)await this.app.repo.accept(e);await this.render();return;}
    if(this.host.isConnected)await this.loadOlder();
  }
  async save(){await this.app.storage.set(this.key,{pager:this.pager.snapshot(),savedAt:Date.now()},TTL.event);}
  async loadOlder(){if(!this.pager)return;await this.pager.older();await this.save();if(this.host.isConnected)await this.render();}
  async refresh(latest=false){if(!this.pager)return;await this.pager.refresh({latest});await this.save();if(this.host.isConnected)await this.render();}
  async insert(event){if(!this.pager)return;this.pager.events.set(event.id,event);await this.save();if(this.host.isConnected)await this.render();}
  async render(){
    if(!this.host.isConnected)return;
    const app=this.app;const events=sortEvents([...this.pager.events.values()]);
    // Filter cheap content/key rules before asking relays for metadata.
    const candidates=events.filter(e=>!this.moderate||(!app.moderation.pubkeyMuted(e.pubkey)&&(this.notification||!app.moderation.content.some(r=>r.test(e.content)))));
    await app.repo.profiles(candidates.map(e=>e.pubkey));if(!this.host.isConnected)return;
    const visible=candidates.filter(e=>(!this.threadId||app.parentId(e)===this.threadId)&&(!this.moderate||!app.moderation.muted(e,app.repo.peekProfile(e.pubkey),{notification:this.notification})));
    this.visibleEvents=visible;
    this.list.replaceChildren(...visible.map(e=>app.posts.render(e,{notification:this.notification})));
    if(!visible.length)this.list.append(empty(events.length?'表示できる投稿がありません':'投稿が見つかりません',events.length?'現在のミュート・プロフィール表示条件で非表示になっています。設定で変更できます。':'設定中のリレーの範囲です。新着確認または別のリレーでお試しください。'));
    const hidden=events.length-visible.length;
    this.status.textContent=[this.pager.warning,hidden?`${hidden}件を表示条件または返信階層により非表示`:null].filter(Boolean).join(' · ');
    this.more.hidden=this.pager.exhausted;this.more.textContent=this.pager.exhausted?'取得済み':'さらに読み込む';
  }
}
export function feedFilters(app,view){
  if(view==='global')return [{kinds:[1]}];
  if(view==='notifications')return [{kinds:[1,7],'#p':[app.session.pubkey]}];
  const authors=[...new Set([app.session.pubkey,...app.social.following])];return chunks(authors,100).map(group=>({kinds:[1],authors:group}));
}
