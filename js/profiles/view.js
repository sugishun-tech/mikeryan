import { relayTab } from './relays-view.js?v=1.2.3';
import { editProfileDialog } from './editor.js?v=1.2.3';
export { editProfileDialog };
import { FollowerDirectory } from '../social/followers.js?v=1.2.3';
import { FeedView } from '../feed/view.js?v=1.2.3';
import { pubkeys } from '../social/service.js?v=1.2.3';
import { el, avatar, button, busy, empty, loading, richText, copy } from '../ui/dom.js?v=1.2.3';
import { profileHref } from '../core/router.js?v=1.2.3';
import { encodeKey } from '../core/nip19.js?v=1.2.3';
import { validProfile } from './cache.js?v=1.2.3';
import { safeURL, latest } from '../core/utils.js?v=1.2.3';
export class ProfileView {
  constructor(app,route,host){this.app=app;this.route=route;this.host=host;this.owner=route.pubkey;this.offset=0;this.listOperation=null;this.listVersion=0;this.loadedUsers=new Set();this.list=el('div',{class:'profile-tab-content'});}
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
      const read=button(`${label}を取得`,()=>this.runList(async()=>{if(type==='followers')await this.followers();else await this.localList(type);}),'button secondary');
      this.list.append(read,empty('まだ取得していません',`「${label}を取得」を押してください。`));
    }
  }
  paintHeader(){
    const {app,owner}=this,profile=app.repo.peekProfile(owner);
    const cover=el('div',{class:'profile-banner'}),url=safeURL(profile.banner,{image:true});if(url&&app.settings.value.loadImages)cover.append(el('img',{src:url,alt:'',referrerPolicy:'no-referrer',loading:'lazy'}));
    const actions=el('div',{class:'profile-actions'});
    if(owner===app.session.pubkey){
      const edit=button('プロフィールを編集',()=>busy(edit,async()=>{
        const context=app.social.sessionContext();
        let profile=app.repo.peekProfile(owner);
        if(!app.repo.knownProfile(owner)){
          const event=await app.repo.replacement(0,owner,{fresh:true,all:true,required:true});
          if(event&&!validProfile(event))throw new Error('既存プロフィールのJSONが不正です。上書きは中止しました');
          profile=event?JSON.parse(event.content):{};
        }
        app.social.checkSession(context);
        if(this.header.isConnected)editProfileDialog(app,profile);
      }),'button secondary');
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
  runList(task) {
    if (this.listOperation) return this.listOperation;
    this.listOperation = Promise.resolve().then(async () => {
      this.list.setAttribute('aria-busy', 'true');
      this.list.querySelectorAll('button').forEach(b => b.disabled = true);
      try { return await task(); }
      catch (error) {
        if (this.list.isConnected) {
          this.listStatus ??= el('p', {class:'list-note',role:'status'});
          if (!this.listStatus.isConnected) this.list.append(this.listStatus);
          this.listStatus.textContent = error.message + '。同じ取得ボタンで再試行できます。';
        }
      } finally {
        this.list.removeAttribute('aria-busy');
        this.list.querySelectorAll('button').forEach(b => b.disabled = false);
        this.app.identity.updateFollows();
      }
    }).finally(() => {this.listOperation = null;});
    return this.listOperation;
  }
  async localList(type) {
    const spinner = loading(); this.list.append(spinner);
    let source;
    try { source = await this.app.repo.replacement(type === 'following' ? 3 : 10000, this.owner, {required:true}); }
    finally { spinner.remove(); }
    if (!this.list.isConnected) return;
    if (type === 'following') source = latest([source, this.app.repo.replacements.get(`3:${this.owner}`)]);
    this.listVersion++; this.items = pubkeys(source); this.offset = 0;
    this.rowNodes = new Map(); this.list.replaceChildren();
    if (type === 'mutes') this.list.append(el('p', {class:'list-note'}, '公開されているpタグのみ表示します。暗号化された非公開ミュートは取得・復号しません。'));
    const refresh = button('一覧を更新', () => this.runList(() => this.localList(type)), 'text-button');
    this.listStatus = el('p', {class:'list-note',role:'status'});
    this.rows = el('div', {});
    this.more = button('次の30人を表示', () => this.runList(() => this.appendLocal(type)), 'button load-more');
    this.retryDetails = button('表示中の補助情報を再取得', () => this.runList(() =>
      this.loadDetails([...this.rowNodes.keys()], {type})), 'text-button');
    this.list.append(refresh, this.listStatus, this.rows, this.more, this.retryDetails);
    this.list.querySelectorAll('button').forEach(b => b.disabled = !!this.listOperation);
    if (!this.items.length) {this.rows.append(empty('公開リストは空です'));this.more.hidden = true;this.retryDetails.hidden = true;return;}
    await this.appendLocal(type);
  }
  async appendLocal(type) {
    const page = this.items.slice(this.offset, this.offset + 30);
    if (!this.rows.isConnected || !page.length) return;
    // Membership comes from the signed list, NOT metadata or mutual status.
    // Paint the public-key row before doing any optional network requests.
    for (const key of page) {
      const row = this.app.identity.userRow(key, {mutual:type === 'following' ? null : false, owner:type === 'following' ? this.owner : null});
      this.rows.append(row); this.rowNodes.set(key, row);
    }
    this.offset += page.length; this.more.hidden = this.offset >= this.items.length;
    await this.loadDetails(page, {type});
  }
  async loadDetails(users, {type, refreshOwn = false} = {}) {
    const rows = this.rows, version = this.listVersion;
    this.listStatus.textContent = `${this.rowNodes.size}人を表示 · 補助情報を確認中…`;
    const [profiles, mutual] = await Promise.allSettled([
      this.app.repo.profiles(users),
      type === 'following' ? this.app.social.followingBack(this.owner, users) :
        type === 'followers' ? (async () => {
          if (refreshOwn) await this.followerDirectory.readOwner();
          const event = latest([this.followerDirectory.ownerEvent, this.app.repo.replacements.get(`3:${this.owner}`)]);
          return event ? new Set(pubkeys(event)) : null;
        })() : Promise.resolve(new Set())
    ]);
    if (!rows.isConnected || rows !== this.rows || version !== this.listVersion) return;
    const mutuals = mutual.status === 'fulfilled' ? mutual.value : null;
    for (const key of users) {
      const previous = this.rowNodes.get(key); if (!previous) continue;
      const state = !mutuals || mutuals.unknown?.has(key) ? null : mutuals.has(key);
      const row = this.app.identity.userRow(key, {mutual:state, owner:type === 'mutes' ? null : this.owner});
      previous.replaceWith(row); this.rowNodes.set(key, row);
    }
    const incomplete = profiles.status === 'rejected' || profiles.value?.complete === false ||
      mutual.status === 'rejected' || !mutuals || mutuals.complete === false;
    this.detailsWarning = incomplete ? 'プロフィールまたは相互フォローの確認が一部未完了です。未確認は非フォローと区別しています。補助情報を再取得できます。' : '';
    this.listStatus.textContent = `${this.rowNodes.size}人を表示` + (this.detailsWarning ? ' · ' + this.detailsWarning : '');
    this.retryDetails.hidden = !incomplete;
    if (type === 'followers') this.paintFollowerStatus();
  }
  async followers() {
    const directory = new FollowerDirectory(this.app.repo, this.app.social, this.owner);
    const first = await directory.next();
    if (!this.list.isConnected) return;
    // Keep the current directory and all its rows if every discovery lane failed.
    // A subset reconstructed from old mutuals is not a successful fresh directory.
    if (this.rowNodes?.size && !directory.ownerComplete && directory.streams.every(stream => !!stream.pager.warning)) {
      throw new Error('フォロワー一覧の更新を確認できませんでした。表示済みの一覧を維持しています');
    }
    this.listVersion++; this.list.replaceChildren();
    this.list.append(el('p', {class:'list-note'}, '設定中の読み取りリレーで確認できたフォロワーです。全Nostrの総数ではありません。リレーごとに候補を探し、本人のフォロー先からも相互フォローを確認します。未取得・通信失敗はフォロー解除とみなしません。'));
    this.followerDirectory = directory;
    this.loadedUsers = new Set(); this.rowNodes = new Map(); this.detailsWarning = '';
    this.rows = el('div', {}); this.listStatus = el('p', {class:'list-note',role:'status'});
    this.more = button('次の30人を表示', () => this.runList(() => this.appendFollowers()), 'button load-more');
    const refresh = button('フォロワーを更新', () => this.runList(() => this.followers()), 'text-button');
    this.retryFollowers = button('未確認の候補を再確認', () => this.runList(() => this.appendFollowers(true)), 'text-button');
    this.retryFollowers.hidden = true;
    this.retryDetails = button('表示中の補助情報を再取得', () => this.runList(() =>
      this.loadDetails([...this.rowNodes.keys()], {type:'followers',refreshOwn:true})), 'text-button');
    this.retryDetails.hidden = true;
    this.list.append(refresh, this.listStatus, this.rows, this.more, this.retryFollowers, this.retryDetails);
    this.list.querySelectorAll('button').forEach(b => b.disabled = !!this.listOperation);
    await this.appendFollowers(false, first);
  }
  paintFollowerStatus() {
    const directory = this.followerDirectory;
    this.more.hidden = directory.exhausted;
    this.retryFollowers.hidden = !directory.needsRetry;
    const warnings = [directory.warning, this.detailsWarning].filter(Boolean);
    this.listStatus.textContent = `${this.rowNodes.size}人を表示` + (warnings.length ? ' · ' + warnings.join(' ') : '') +
      (!directory.exhausted ? ' · 未確認の期間・候補があります。「次の30人を表示」で続けられます。' : directory.needsRetry ? ' · 候補の探索は終了しました。未確認の状態は再確認できます。' : ' · 読み取りリレー内の候補を最後まで確認しました。');
  }
  async appendFollowers(retry = false, initialPage = null) {
    const rows = this.rows, version = this.listVersion, directory = this.followerDirectory;
    const page = initialPage ?? await (retry ? directory.retry() : directory.next());
    if (!rows.isConnected || rows !== this.rows || version !== this.listVersion) return;
    for (const key of page.removed) {
      this.rowNodes.get(key)?.remove(); this.rowNodes.delete(key); this.loadedUsers.delete(key);
    }
    this.rows.querySelector('.empty-state')?.remove();
    for (const key of page.users) {
      if (this.rowNodes.has(key)) continue;
      const row = this.app.identity.userRow(key, {mutual:null,owner:this.owner});
      this.rows.append(row); this.rowNodes.set(key,row); this.loadedUsers.add(key);
    }
    if (!this.rowNodes.size) this.rows.append(empty('この確認ではフォロワーが見つかりません',
      directory.exhausted ? '確認範囲は設定中の読み取りリレーに限られます。' : '別の期間・本人のフォロー先も続けて確認できます。'));
    await this.loadDetails(retry ? [...this.rowNodes.keys()] : page.users, {type:'followers'});
  }
}
