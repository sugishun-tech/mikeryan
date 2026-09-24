import { editProfileDialog } from './editor.js?v=1.1.0';
export { editProfileDialog };
import { EventPager } from '../feed/pagination.js?v=1.1.0';
import { FeedView } from '../feed/view.js?v=1.1.0';
import { pubkeys } from '../social/service.js?v=1.1.0';
import { el, avatar, button, busy, empty, loading, richText, copy } from '../ui/dom.js?v=1.1.0';
import { profileHref } from '../core/router.js?v=1.1.0';
import { encodeKey } from '../core/nip19.js?v=1.1.0';
import { safeURL, unique, stableJSON } from '../core/utils.js?v=1.1.0';
export class ProfileView {
  constructor(app,route,host){this.app=app;this.route=route;this.host=host;this.owner=route.pubkey;this.offset=0;this.loadedUsers=new Set();this.list=el('div',{class:'profile-tab-content'});}
  async init(){
    const {app,owner}=this;this.host.append(loading());
    const profile=await app.repo.profile(owner);if(!this.host.isConnected)return;
    const cover=el('div',{class:'profile-banner'}),url=safeURL(profile.banner,{image:true});if(url&&app.settings.value.loadImages)cover.append(el('img',{src:url,alt:'',referrerPolicy:'no-referrer',loading:'lazy'}));
    const actions=el('div',{class:'profile-actions'});
    if(owner===app.session.pubkey){
      const edit=button('プロフィールを編集',()=>busy(edit,()=>editProfileDialog(app,profile)),'button secondary');
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
    const refreshProfile=button('プロフィール更新',()=>busy(refreshProfile,async()=>{await app.render(this.route);}), 'text-button');
    info.append(el('div',{class:'key-actions'},refreshProfile,button('npubをコピー',()=>copy(encodeKey('npub',owner)),'text-button'),button('hexをコピー',()=>copy(owner),'text-button')));
    const tabs=el('nav',{class:'profile-tabs','aria-label':'プロフィールの項目'});
    for(const [id,label]of Object.entries({posts:'投稿',following:'フォロー',followers:'フォロワー',mutes:'ミュート',relays:'リレー'}))tabs.append(el('a',{href:profileHref(owner,id),class:this.route.tab===id?'active':'','aria-current':this.route.tab===id?'page':null},label));
    this.host.replaceChildren(cover,info,tabs,this.list);
    if(this.route.tab==='posts'){
      this.feed=new FeedView(app,this.list,{key:`profile:${owner}`,filters:[{kinds:[1],authors:[owner]}],moderate:false});await this.feed.init();
    }else if(this.route.tab==='followers')await this.followers();
    else if(this.route.tab==='relays')await this.relays();
    else await this.localList(this.route.tab);
  }
  async localList(type){
    const app=this.app;this.list.append(loading());
    const source=await app.repo.replacement(type==='following'?3:10000,this.owner);if(!this.list.isConnected)return;
    this.items=pubkeys(source);this.list.replaceChildren();
    if(type==='mutes')this.list.append(el('p',{class:'list-note'},'公開されているpタグのみ表示します。暗号化された非公開ミュートは取得・復号しません。'));
    const refresh=button('一覧を更新',()=>busy(refresh,async()=>{this.offset=0;this.list.replaceChildren();await this.localList(type);}),'text-button');this.list.append(refresh);
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
    const app=this.app;this.list.append(el('p',{class:'list-note'},'設定中のリレーで見つかったフォロワーです。全Nostrの総数ではありません。候補の最新フォローリストを確認してから表示します。'));
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
    const current=await app.social.followingBack(this.owner,candidates);
    const users=candidates.filter(p=>current.has(p));await app.repo.profiles(users);
    const own=new Set(pubkeys(await app.repo.replacement(3,this.owner)));if(!this.rows.isConnected)return;
    this.rows.querySelector('.empty-state')?.remove();for(const p of users){this.rows.append(app.identity.userRow(p,{mutual:own.has(p),owner:this.owner}));this.loadedUsers.add(p);}
    if(!this.loadedUsers.size)this.rows.append(empty('このページではフォロワーが見つかりません','次の30人を表示すると別の期間を確認できます。'));
    this.more.hidden=this.followerPager.exhausted;
  }
  async relays(){
    this.list.append(loading());const relays=await this.app.social.relays(this.owner);if(!this.list.isConnected)return;
    this.list.replaceChildren(el('p',{class:'list-note'},'NIP-65（kind:10002）を優先し、なければ従来のkind:3設定を表示します。ここを開くだけでは追加リレーへ接続しません。'));
    if(!relays.length)this.list.append(empty('公開リレー情報がありません'));
    for(const r of relays)this.list.append(el('div',{class:'relay-row'},el('code',{},String(r.url)),el('span',{class:'pill'},r.mode)));
  }
}
