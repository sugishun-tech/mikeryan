import { relayTab } from './relays-view.js?v=1.2.0';
import { editProfileDialog } from './editor.js?v=1.2.0';
export { editProfileDialog };
import { EventPager } from '../feed/pagination.js?v=1.2.0';
import { FeedView } from '../feed/view.js?v=1.2.0';
import { pubkeys } from '../social/service.js?v=1.2.0';
import { el, avatar, button, busy, empty, loading, richText, copy } from '../ui/dom.js?v=1.2.0';
import { profileHref } from '../core/router.js?v=1.2.0';
import { encodeKey } from '../core/nip19.js?v=1.2.0';
import { safeURL, unique, stableJSON } from '../core/utils.js?v=1.2.0';
export class ProfileView {
  constructor(app,route,host){this.app=app;this.route=route;this.host=host;this.owner=route.pubkey;this.offset=0;this.loadedUsers=new Set();this.list=el('div',{class:'profile-tab-content'});}
  async init(){
    const {app,owner}=this;this.host.append(loading());
    await app.repo.cachedProfiles([owner]);if(!this.host.isConnected)return;
    this.header=el('div',{class:'profile-header'});this.paintHeader();
    const tabs=el('nav',{class:'profile-tabs','aria-label':'プロフィールの項目'});
    for(const [id,label]of Object.entries({posts:'投稿',following:'フォロー',followers:'フォロワー',mutes:'ミュート',relays:'リレー'}))tabs.append(el('a',{href:profileHref(owner,id),class:this.route.tab===id?'active':'','aria-current':this.route.tab===id?'page':null},label));
    this.host.replaceChildren(this.header,tabs,this.list);
    if(this.route.tab==='posts'){
      this.feed=new FeedView(app,this.list,{key:`profile:${owner}`,filters:[{kinds:[1],authors:[owner]}],moderate:false});await this.feed.init();
    }else if(this.route.tab==='relays')relayTab(app,owner,this.list);
    else {
      const type=this.route.tab,label=({following:'フォロー',followers:'フォロワー',mutes:'ミュート'})[type];
      const read=button(`${label}を取得`,()=>busy(read,async()=>{if(type==='followers')await this.followers();else await this.localList(type);}),'button secondary');
      this.list.append(read,empty('まだ取得していません',`「${label}を取得」を押してください。`));
    }
  }
  paintHeader(){
    const {app,owner}=this,profile=app.repo.peekProfile(owner);
    const cover=el('div',{class:'profile-banner'}),url=safeURL(profile.banner,{image:true});if(url&&app.settings.value.loadImages)cover.append(el('img',{src:url,alt:'',referrerPolicy:'no-referrer',loading:'lazy'}));
    const actions=el('div',{class:'profile-actions'});
    if(owner===app.session.pubkey){
      const edit=button('プロフィールを編集',()=>busy(edit,async()=>editProfileDialog(app,app.repo.knownProfile(owner)?app.repo.peekProfile(owner):await app.repo.profile(owner,{fresh:true}))),'button secondary');
      actions.append(edit);
    }
    else if(app.session.pubkey)actions.append(app.identity.followButton(owner));
    const about=el('div',{class:'profile-about collapsed'},richText(String(profile.about??'')));
    const expand=button('さらに表示',()=>{about.classList.toggle('collapsed');expand.textContent=about.classList.contains('collapsed')?'さらに表示':'閉じる';},'text-button');
    const info=el('div',{class:'profile-info'},el('div',{class:'profile-top'},avatar(profile,'avatar profile-avatar',app.settings.value.loadImages),actions),app.identity.mount(owner,{large:true}),about);
    if(String(profile.about??'').length>180)info.append(expand);
    if(profile.nip05)info.append(el('div',{class:'profile-identifier'},String(profile.nip05)));
    const website=safeURL(profile.website);if(website)info.append(el('a',{href:website,target:'_blank',rel:'noopener noreferrer',class:'profile-website'},website));
    if(profile.lud16)info.append(el('div',{class:'muted-text'},'⚡ '+String(profile.lud16)));
    const refreshProfile=button('プロフィールを更新',()=>busy(refreshProfile,async()=>{await app.repo.profile(owner,{fresh:true});if(!this.header.isConnected)return;this.paintHeader();app.identity.refresh(owner);}), 'text-button');
    info.append(el('div',{class:'key-actions'},refreshProfile,button('npubをコピー',()=>copy(encodeKey('npub',owner)),'text-button'),button('hexをコピー',()=>copy(owner),'text-button')));
    if(!app.repo.knownProfile(owner))info.append(el('p',{class:'help'},'未取得のプロフィールです。「プロフィールを更新」で取得します。'));
    this.header.replaceChildren(cover,info);
  }
  async localList(type){
    const app=this.app,spinner=loading();this.list.append(spinner);let source;
    try{source=await app.repo.replacement(type==='following'?3:10000,this.owner,{required:true});}finally{spinner.remove();}
    if(!this.list.isConnected)return;
    this.items=pubkeys(source);this.list.replaceChildren();
    if(type==='mutes')this.list.append(el('p',{class:'list-note'},'公開されているpタグのみ表示します。暗号化された非公開ミュートは取得・復号しません。'));
    const refresh=button('一覧を更新',()=>busy(refresh,async()=>{this.offset=0;await this.localList(type);}),'text-button');this.list.append(refresh);
    this.rows=el('div',{});this.more=button('次の30人を表示',()=>busy(this.more,()=>this.appendLocal(type)),'button load-more');this.list.append(this.rows,this.more);
    if(!this.items.length){this.rows.append(empty('公開リストは空です'));this.more.hidden=true;return;}
    await this.appendLocal(type);
  }
  async appendLocal(type){
    const app=this.app,page=this.items.slice(this.offset,this.offset+app.settings.value.batchSize);
    const [,mutual]=await Promise.all([app.repo.profiles(page),type==='following'?app.social.followingBack(this.owner,page):Promise.resolve(new Set())]);
    if(!this.rows.isConnected)return;this.rows.append(...page.map(p=>app.identity.userRow(p,{mutual:mutual.has(p),owner:type==='following'?this.owner:null})));this.offset+=page.length;this.more.hidden=this.offset>=this.items.length;
  }
  async followers(){
    const app=this.app;this.list.replaceChildren();this.list.append(el('p',{class:'list-note'},'設定中のリレーで見つかったフォロワーです。全Nostrの総数ではありません。候補の最新フォローリストを確認してから表示します。'));
    this.followerPager=new EventPager(filters=>app.repo.query(filters),[{kinds:[3],'#p':[this.owner]}],30);
    this.loadedUsers=new Set();this.rows=el('div',{});
    this.more=button('次の30人を表示',()=>busy(this.more,()=>this.appendFollowers()),'button load-more');
    const refresh=button('フォロワーを更新',()=>busy(refresh,async()=>{this.list.replaceChildren();await this.followers();}),'text-button');
    this.list.append(refresh,this.rows,this.more);
    await this.appendFollowers();
  }
  async appendFollowers(){
    const app=this.app,page=await this.followerPager.older();if(!this.rows.isConnected)return;
    const candidates=unique(page.map(e=>e.pubkey)).filter(p=>!this.loadedUsers.has(p));
    // '#p' is discovery, not proof of CURRENT following: fetch the unfiltered latest kind:3.
    const current=await app.social.followingBack(this.owner,candidates);if(!this.rows.isConnected)return;
    const users=candidates.filter(p=>current.has(p));await app.repo.profiles(users);
    const own=new Set(pubkeys(await app.repo.replacement(3,this.owner)));if(!this.rows.isConnected)return;
    this.rows.querySelector('.empty-state')?.remove();for(const p of users){this.rows.append(app.identity.userRow(p,{mutual:own.has(p),owner:this.owner}));this.loadedUsers.add(p);}
    if(!this.loadedUsers.size)this.rows.append(empty('このページではフォロワーが見つかりません','次の30人を表示すると別の期間を確認できます。'));
    this.more.hidden=this.followerPager.exhausted;
  }
}
