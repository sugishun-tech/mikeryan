import { Storage } from './core/storage.js?v=1.2.0';
import { Settings } from './settings/store.js?v=1.2.0';
import { NetworkClient } from './network/client.js?v=1.2.0';
import { Session } from './auth/session.js?v=1.2.0';
import { Repository } from './core/repository.js?v=1.2.0';
import { Nip05 } from './profiles/nip05.js?v=1.2.0';
import { Social } from './social/service.js?v=1.2.0';
import { Moderation } from './feed/moderation.js?v=1.2.0';
import { Identity } from './ui/identity.js?v=1.2.0';
import { Posts } from './ui/posts.js?v=1.2.0';
import { Router, profileHref, threadHref } from './core/router.js?v=1.2.0';
import { FeedView, feedFilters, composer } from './feed/view.js?v=1.2.0';
import { ProfileView } from './profiles/view.js?v=1.2.0';
import { settingsView } from './settings/view.js?v=1.2.0';
import { el, button, busy, icon, avatar, loading, empty, toast } from './ui/dom.js?v=1.2.0';
import { parentId, stableJSON, matchesFilter } from './core/utils.js?v=1.2.0';
import { decodeKey } from './core/nip19.js?v=1.2.0';
class App {
  async start(){
    this.settings=new Settings();await this.settings.load();this.storage=new Storage();
    this.network=new NetworkClient();this.session=new Session();this.session.restore();
    this.nip05=new Nip05(this.storage);this.repo=new Repository(this.storage,this.network,this.settings,{verifier:this.nip05});
    this.social=new Social(this.repo,this.session,this.settings,this.storage,this.network);this.moderation=new Moderation(this.settings,this.repo,this.session);
    this.identity=new Identity(this);this.posts=new Posts(this);this.parentId=parentId;this.router=new Router(route=>this.render(route));
    this.accountKey=null;this.accountReady=Promise.resolve();this.onPosted=null;this.routeToken=0;this.lastWarning='';
    this.applyTheme();this.bind();await this.repo.cachedProfiles([this.session.pubkey]);this.updateAccount();await this.router.start();
  }
  applyTheme(){document.documentElement.dataset.theme=this.settings.value.theme;}
  bind(){
    const nav=document.getElementById('navigation');
    for(const [view,label,name]of [['home','ホーム','home'],['global','グローバル','globe'],['notifications','通知','bell'],['me','プロフィール','user'],['settings','設定','settings']])nav.append(el('a',{href:'#/'+view,class:'nav-item',dataset:{view}},icon(name),el('span',{},label)));
    const back=document.getElementById('back-button');back.append(icon('back',21));back.addEventListener('click',()=>this.router.back());
    document.getElementById('compose-shortcut').addEventListener('click',async()=>{if(!this.session.pubkey){try{await this.login();}catch(e){toast(e.message,true);}return;}if(!document.querySelector('.composer textarea')){this.router.go('#/home');return;}document.querySelector('.composer textarea')?.focus();window.scrollTo({top:0,behavior:'smooth'});});
    document.getElementById('search-button').append(icon('search',20));
    document.getElementById('mobile-search-button').append(icon('search',20));
    document.getElementById('mobile-search-button').addEventListener('click',()=>this.searchDialog());
    document.getElementById('search-form').addEventListener('submit',e=>{e.preventDefault();const b=document.getElementById('search-button');void busy(b,async()=>{const input=document.getElementById('search-input').value.trim();if(!input)return;
      await this.search(input);
    });});
    this.session.on('change',()=>{this.repo.resetSession();this.accountKey=null;this.updateAccount();void this.render(this.router.route??{view:'global'});});
    this.social.on('following',()=>this.identity.updateFollows());this.social.on('followBusy',()=>this.identity.updateFollows());
    this.social.on('like',()=>this.posts.updateLikes());this.social.on('likes',()=>this.posts.updateLikes());
    this.social.on('notice',message=>toast(message));
    this.settings.on('change',()=>{this.moderation.rebuild();this.applyTheme();this.accountKey=null;});
    this.repo.on('warning',message=>{if(message!==this.lastWarning){this.lastWarning=message;toast('一部のリレーとの通信を休止しました。設定画面に理由を表示します。',true);}});
    this.repo.on('storageWarning',()=>toast('プロフィールを永続保存できません。サイトデータの保存許可・容量を確認してください。今回の表示は継続します。',true));
    this.repo.on('replace',({event})=>{if(event.kind===0){if(event.pubkey===this.session.pubkey)this.updateAccount();this.identity.refresh(event.pubkey);}});
    window.addEventListener('online',()=>toast('接続が戻りました。読み込みボタンで取得できます'));
    window.addEventListener('offline',()=>toast('オフラインです。新しい投稿は取得できません。',true));
    window.addEventListener('unhandledrejection',event=>{console.error(event.reason);toast(event.reason?.message??'処理に失敗しました',true);});
  }
  async search(raw){
    const input=String(raw).trim();if(!input)return;
    if(input.includes('@')){this.router.go(profileHref(await this.nip05.resolve(input)));return;}
    const d=decodeKey(input);this.router.go(['note','nevent'].includes(d.type)?threadHref(d.data):profileHref(d.data));
  }
  searchDialog(){
    const dialog=el('dialog',{class:'edit-dialog'}),input=el('input',{placeholder:'npub / hex / NIP-05',type:'text','aria-label':'公開鍵またはNIP-05を検索',autocomplete:'off',spellcheck:false});
    const submit=button('検索',()=>busy(submit,async()=>{await this.search(input.value);dialog.close();}),'button primary');
    const form=el('form',{},el('div',{class:'dialog-header'},el('h2',{},'ユーザー・投稿を検索'),button('閉じる',()=>dialog.close(),'text-button')),input,submit);
    form.addEventListener('submit',event=>{event.preventDefault();submit.click();});dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();input.focus();
  }
  async ensureAccount(){
    const key=this.session.pubkey;
    if(key && this.accountKey!==key){this.accountKey=key;this.accountReady=this.social.loadAccount().catch(error=>{if(this.accountKey===key)this.accountKey=null;throw error;}).finally(()=>this.updateAccount());}
    return this.accountReady;
  }
  login(){return this.session.login();}
  updateAccount(){
    const account=document.getElementById('account');if(!account)return;const key=this.session.pubkey;
    if(!key){const login=button('NIP-07でログイン',()=>busy(login,()=>this.login()),'button primary');account.replaceChildren(login);return;}
    const profile=this.repo.peekProfile(key);account.replaceChildren(el('a',{href:profileHref(key),class:'account-link'},avatar(profile,'avatar small',this.settings.value.loadImages),el('div',{},el('strong',{},profile.display_name||profile.name||'アカウント'),el('span',{class:'user-handle'},profile.name?'@'+profile.name:key.slice(0,10)+'…'))));
  }
  async render(route){
    const token=++this.routeToken;window.scrollTo(0,0);this.onPosted=null;this.activeFeed?.dispose();this.activeFeed=null;this.identity.reset();this.repo.beginView(this.session.pubkey);this.social.beginView();this.accountKey=null;const outer=document.getElementById('view'),host=el('section',{class:'view-section'});outer.replaceChildren(host);host.append(loading());
    document.title=`${({global:'グローバル',home:'ホーム',notifications:'通知',profile:'プロフィール',me:'プロフィール',settings:'設定',thread:'スレッド'})[route.view]} / mikeryan`;
    document.getElementById('page-title').textContent=({global:'グローバル',home:'ホーム',notifications:'通知',profile:'プロフィール',me:'プロフィール',settings:'設定',thread:'スレッド'})[route.view]??'mikeryan';
    for(const a of document.querySelectorAll('.nav-item'))a.classList.toggle('active',a.dataset.view===route.view||(route.view==='profile'&&route.pubkey===this.session.pubkey&&a.dataset.view==='me'));
    try{
      if(route.view==='settings'){host.replaceChildren();await settingsView(this,host);return;}
      if(['home','notifications','me'].includes(route.view)&&!this.session.pubkey){host.replaceChildren(empty('ログインが必要です','NIP-07対応の拡張機能でログインしてください。'));const login=button('NIP-07でログイン',()=>busy(login,()=>this.login()),'button primary');host.append(el('div',{class:'centered'},login));return;}
      await this.repo.cachedProfiles([this.session.pubkey]);this.updateAccount();if(token!==this.routeToken)return;
      if(route.view==='me'){this.router.go(profileHref(this.session.pubkey));return;}
      host.replaceChildren();
      if(route.view==='profile'){
        const page=new ProfileView(this,route,host);await page.init();if(token!==this.routeToken)return;
        this.onPosted=event=>{if(page.feed&&event.pubkey===route.pubkey)return page.feed.insert(event);};
      }else if(route.view==='thread'){
        const read=button('投稿を取得',()=>busy(read,()=>this.thread(route.id,host,token)),'button secondary');
        host.append(read,empty('まだ取得していません','「投稿を取得」を押すと本文と返信先を取得します。'));
      }
      else{
        const filters=feedFilters(this,route.view);
        const key=route.view==='home'?`home:${this.session.pubkey}:${stableJSON([...this.social.following].sort())}`:route.view==='notifications'?`notifications:${this.session.pubkey}`:route.view;
        const feed=new FeedView(this,host,{key,filters,notification:route.view==='notifications',composerEnabled:route.view!=='notifications',beforeRead:async()=>{await this.ensureAccount();return feedFilters(this,route.view);}});await feed.init();if(token!==this.routeToken)return;
        this.onPosted=event=>{if(feed.pager.baseFilters.some(f=>matchesFilter(event,f)))return feed.insert(event);};
      }
    }catch(e){if(token===this.routeToken){host.replaceChildren(empty('読み込みに失敗しました',e.message));host.append(button('もう一度試す',()=>void this.render(route),'button secondary'));}}
  }
  async thread(id,host,token){
    const event=await this.repo.event(id);if(token!==this.routeToken)return;
    if(!event){host.append(empty('投稿が見つかりません','設定中の読み取りリレーに保存されていない可能性があります。'));return;}
    await this.repo.profiles([event.pubkey]);if(token!==this.routeToken)return;
    host.querySelectorAll(':scope > .empty-state, :scope > .thread-focus, :scope > .thread-parent, :scope > .composer, :scope > .thread-replies').forEach(node=>node.remove());
    this.activeFeed?.dispose();
    const parent=parentId(event);
    if(parent){const target=await this.repo.event(parent);if(token!==this.routeToken)return;if(target){await this.repo.profiles([target.pubkey]);if(token!==this.routeToken)return;host.append(el('div',{class:'thread-parent'},this.posts.render(target)));}}
    host.append(this.posts.render(event,{thread:true}));
    if(event.kind!==1)return;
    host.append(composer(this,event));const replies=el('section',{class:'thread-replies'},el('h2',{class:'section-title'},'返信'));host.append(replies);
    const feed=new FeedView(this,replies,{key:`thread:${id}`,filters:[{kinds:[1],'#e':[id]}],threadId:id});await feed.init();if(token!==this.routeToken)return;
    this.onPosted=reply=>{if(parentId(reply)===id)return feed.insert(reply);};
  }
}
const app=new App();
app.start().catch(error=>{console.error(error);document.getElementById('view').replaceChildren(empty('起動できませんでした',error.message));});

export { app, App };
