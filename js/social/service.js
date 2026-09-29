import { relayEntries, relayListTags, changeRelayTags } from '../profiles/relay-list.js?v=1.2.3';
import { APP_NAME, OUTBOX_RETENTION, storagePrefix } from '../core/config.js?v=1.2.3';
import { Emitter, compareEvents, isHex, latest, nowSeconds, normalizeRelay, parseJSON, replyTags, unique } from '../core/utils.js?v=1.2.3';
const pubkeys = event => unique((event?.tags ?? []).filter(t=>t[0]==='p' && isHex(t[1])).map(t=>t[1]));
export { pubkeys };
export class Social extends Emitter {
  constructor(repository, session, settings, storage, network) {
    super(); this.repo=repository;this.session=session;this.settings=settings;this.storage=storage;this.network=network;
    this.following=new Set();this.followingKnown=false;this.likes=new Set();this.pending=new Set();this.writeQueue=Promise.resolve();this.outboxQueue=Promise.resolve();this.deliveries=new Map();
    this.repo.on('replace',({event})=>{if(event.pubkey===this.session.pubkey && event.kind===3){this.following=new Set(pubkeys(event));this.followingKnown=true;this.emit('following',this.following);}});
  }
  beginView() { this.following=new Set();this.followingKnown=false;this.likes=new Set();this.emit('following',this.following); }
  async loadAccount() {
    const key=this.session.pubkey;if(!key)return;
    const generation=this.repo.generation;
    const [contacts]=await Promise.all([this.repo.replacement(3,key,{required:true}),this.repo.replacement(10000,key,{required:true}),this.repo.profile(key)]);
    if(this.session.pubkey!==key||generation!==this.repo.generation)return;
    this.following=new Set(pubkeys(latest([contacts,this.repo.replacements?.get(`3:${key}`)])));this.followingKnown=true;this.emit('following',this.following);
  }
  sessionContext() { return {pubkey:this.session.pubkey, epoch:this.session.epoch}; }
  sameSession(context) { return !!context.pubkey && this.session.pubkey === context.pubkey && this.session.epoch === context.epoch; }
  checkSession(context) {
    if (!context.pubkey) throw new Error('ログインしてください');
    if (!this.sameSession(context)) throw new Error('操作中にアカウントが変更されました。元のアカウントで操作し直してください');
  }
  async publish(template, context = this.sessionContext()) {
    this.checkSession(context);
    const event=await this.session.sign({...template,tags:[...(template.tags??[]).filter(t=>t[0]!=='client'),['client',APP_NAME]]});
    this.checkSession(context);
    if (event.pubkey !== context.pubkey) throw new Error('署名したアカウントが一致しません');
    return this.sendSigned(event);
  }
  /** Serialize read-modify-write locally and, where available, across tabs.
   * Only signed user-authored deliveries enter this store, never fetched lists.
   */
  updateOutbox(event, results) {
    const task = async () => {
      const key=`outbox:${event.pubkey}`, stored=await this.storage.get(key);
      const outbox=Array.isArray(stored)?stored:[];
      const previous=outbox.find(item=>item.event?.id===event.id);
      const merged=new Map();
      for (const result of [...(previous?.results??[]),...results]) {
        if (!result?.relay) continue;
        if (!merged.get(result.relay)?.accepted) merged.set(result.relay,result);
      }
      const delivery=[...merged.values()], remaining=outbox.filter(item=>item.event?.id!==event.id);
      if (!delivery.length || delivery.some(r=>!r.accepted)) remaining.push({event,results:delivery,time:previous?.time??Date.now()});
      const persistent=await this.storage.set(key,remaining.slice(-30),OUTBOX_RETENTION)!==false;
      if (!persistent) this.emit('notice','再送情報を永続保存できません。このタブを閉じる前に保存許可・容量を確認してください');
      return {results:delivery,persistent};
    };
    const run=this.outboxQueue.then(()=>globalThis.navigator?.locks
      ? navigator.locks.request(`${storagePrefix()}outbox:${event.pubkey}`,task) : task());
    this.outboxQueue=run.catch(()=>{});return run;
  }
  sendSigned(event, relays = this.settings.value.relays, acceptedResults = []) {
    if (this.deliveries.has(event.id)) return this.deliveries.get(event.id);
    const context=this.sessionContext(), generation=this.repo.generation;
    const job=(async()=>{
      this.checkSession(context);
      if (event.pubkey!==context.pubkey) throw new Error('別アカウントの送信は再実行できません');
      const targets=unique(relays.map(normalizeRelay));
      if (!targets.length || targets.includes(null)) throw new Error('送信先リレーが不正です');
      // Persist BEFORE transport: a crashed worker or lost OK must not lose the
      // exact signed event, or encourage composing a duplicate post.
      await this.updateOutbox(event,[...acceptedResults,...targets.map(relay=>({relay,accepted:false,reason:'送信結果を確認中'}))]);
      this.checkSession(context);
      let response;
      try { response=await this.network.publish({event,relays:targets,gap:this.settings.value.requestGapMs}); }
      catch(error) { response={results:targets.map(relay=>({relay,accepted:false,reason:error.message||'送信結果を確認できません'}))}; }
      const saved=await this.updateOutbox(event,[...acceptedResults,...response.results]);
      const result={results:saved.results,accepted:saved.results.filter(r=>r.accepted).length,total:saved.results.length};
      this.emit('delivery',result);
      if (!result.accepted) throw new Error(saved.persistent
        ? 'どのリレーにも受理を確認できませんでした。署名済みイベントを設定の「未完了の送信」に保存しました。新しく投稿し直す前に、そちらから再送してください'
        : 'どのリレーにも受理を確認できず、再送情報の永続保存にも失敗しました。このタブを閉じず、設定の「未完了の送信」から再送してください');
      if (this.sameSession(context) && generation===this.repo.generation) await this.repo.published(event);
      if (result.accepted<result.total) this.emit('notice',`${result.accepted}/${result.total}リレーに保存しました。未達分は設定画面から再送できます`);
      return event;
    })().finally(()=>{if(this.deliveries.get(event.id)===job)this.deliveries.delete(event.id);});
    this.deliveries.set(event.id,job);return job;
  }
  async retry(event) {
    const context=this.sessionContext();this.checkSession(context);
    if(event.pubkey!==context.pubkey)throw new Error('別アカウントの送信は再実行できません');
    if(this.deliveries.has(event.id))return this.deliveries.get(event.id);
    const item=(await this.storage.get(`outbox:${event.pubkey}`)??[]).find(item=>item.event.id===event.id);
    this.checkSession(context);
    if(!item)return event;
    const failed=item.results.filter(r=>!r.accepted).map(r=>r.relay);
    if(!failed.length)return event;
    return this.sendSigned(event,failed,item.results.filter(r=>r.accepted));
  }
  post(content, parent=null) {
    const text=String(content).trim();if(!text)throw new Error('本文を入力してください');
    return this.publish({kind:1,content:text,tags:parent?replyTags(parent,this.session.pubkey):[]});
  }
  async like(event) {
    const context=this.sessionContext();const id=event.id;if(this.likes.has(id)||this.pending.has(`like:${id}`))return;
    this.pending.add(`like:${id}`);
    try{
      const signed=await this.publish({kind:7,content:'+',tags:[['e',event.id],['p',event.pubkey],['k',String(event.kind)]]});
      if(this.sameSession(context)){this.likes.add(id);this.emit('like',id);}
    }finally{this.pending.delete(`like:${id}`);}
  }
  applyLikes(reactions, page, key = this.session.pubkey) {
    if (!key || this.session.pubkey !== key) return;
    // Only update this batch. Do not erase other on-screen or locally published likes.
    for (const e of reactions) {
      if (e.kind !== 7 || e.pubkey !== key) continue;
      const id = e.tags.filter(t => t[0] === 'e').at(-1)?.[1];
      if (id && ['+', '❤', '❤️', '🤙'].includes(e.content)) this.likes.add(id);
    }
    this.emit('likes', this.likes);
  }
  exclusive(kind,task,context=this.sessionContext()) {
    const pubkey=context.pubkey;if(!pubkey)return Promise.reject(new Error('ログインしてください'));
    const run=this.writeQueue.then(async()=>{
      this.checkSession(context);
      const locked=()=>{this.checkSession(context);return task(pubkey,context);};
      return globalThis.navigator?.locks ? navigator.locks.request(`${storagePrefix()}write:${pubkey}:${kind}`,locked) : locked();
    });this.writeQueue=run.catch(()=>{});return run;
  }
  async writeSource(kind,key) {
    const observed=this.repo.replacements?.get(`${kind}:${key}`);
    const remote=await this.repo.replacement(kind,key,{fresh:true,all:true,required:true});
    // Still consult every configured relay. A stale/empty complete reply may
    // not undo a newer, signed state already observed during this operation.
    return latest([remote,observed,this.repo.replacements?.get(`${kind}:${key}`)]);
  }
  async toggleFollow(target) {
    if(!isHex(target)||target===this.session.pubkey)throw new Error('フォロー対象が不正です');
    if(this.pending.has(`follow:${target}`))return;this.pending.add(`follow:${target}`);this.emit('followBusy',target);
    try{return await this.exclusive(3,async (key,context)=>{
      const current=await this.writeSource(3,key);this.checkSession(context);
      const exists=pubkeys(current).includes(target);
      const tags=(current?.tags??[]).filter(t=>!(t[0]==='p'&&t[1]===target));if(!exists)tags.push(['p',target]);
      const event=await this.publish({kind:3,created_at:Math.max(nowSeconds(),(current?.created_at??0)+1),tags,content:current?.content??''},context);
      if(this.sameSession(context)){this.following=new Set(pubkeys(event));this.followingKnown=true;this.emit('following',this.following);}return !exists;
    });}finally{this.pending.delete(`follow:${target}`);this.emit('followBusy',target);}
  }
  editProfile(fields,context=this.sessionContext()) {
    fields=structuredClone(fields);
    return this.exclusive(0,async (key,scope)=>{
      const current=await this.writeSource(0,key);this.checkSession(scope);
      const profile=current?parseJSON(current.content,null):{};
      if(!profile||typeof profile!=='object'||Array.isArray(profile))throw new Error('既存プロフィールのJSONが不正です');
      for(const k of ['name','display_name','about','picture','banner','nip05','website','lud16']){
        if(fields[k]===undefined)continue;const value=String(fields[k]).trim();if(value)profile[k]=value;else delete profile[k];
      }
      return this.publish({kind:0,created_at:Math.max(nowSeconds(),(current?.created_at??0)+1),content:JSON.stringify(profile),tags:current?.tags??[]},scope);
    },context);
  }
  async list(kind,owner) { return pubkeys(await this.repo.replacement(kind,owner)); }
  async followingBack(owner, candidates, {evidence = []} = {}) {
    if (!isHex(owner)) throw new Error('公開鍵が不正です');
    const keys = unique(candidates).filter(isHex), generation = this.repo.generation;
    // A reverse-index result is already a verified kind:3 event. Do not throw
    // it away when an author lookup is missing, older, or partially offline.
    // These records are view-local evidence, never a persistent list cache.
    const requested = new Set(keys), seeds = new Map();
    for (const event of evidence) if (event?.kind === 3 && requested.has(event.pubkey)) {
      seeds.set(event.pubkey, latest([seeds.get(event.pubkey), event]));
    }
    const reads = await Promise.allSettled(keys.map(key => this.repo.replacementRead(3, key)));
    if (generation !== this.repo.generation) throw new Error('表示先が変更されました');
    const back = new Set();
    back.contacts = new Map(); back.unknown = new Set(); back.incomplete = new Set(); back.errors = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i], read = reads[i];
      const result = read.status === 'fulfilled' ? read.value : {events:[], complete:false, errors:[{reason:read.reason?.message ?? '取得失敗'}]};
      const current = latest([seeds.get(key), ...(result.events ?? []), this.repo.replacements?.get(`3:${key}`)]
        .filter(event => event?.kind === 3 && event.pubkey === key));
      if (current) {
        back.contacts.set(key, current);
        await this.repo.accept(current);
        if (pubkeys(current).includes(owner)) back.add(key);
      } else back.unknown.add(key);
      // No event is NOT a signed empty list. Keep it distinguishable from an
      // explicit unfollow, and retain retry controls without hiding other users.
      const observed = latest((result.events ?? []).filter(event => event?.kind === 3 && event.pubkey === key));
      if (!result.complete || !observed || (current && compareEvents(observed, current) > 0)) back.incomplete.add(key);
      back.errors.push(...(result.errors ?? []));
    }
    back.complete = back.incomplete.size === 0;
    return back;
  }
  async relaySource(owner, options={}) {
    const modern=await this.repo.replacement(10002,owner,options);
    const contacts=modern?null:await this.repo.replacement(3,owner,options);
    return {modern,contacts,entries:relayEntries(modern,contacts)};
  }
  async relays(owner) { return (await this.relaySource(owner,{required:true})).entries; }
  changeRelay(owner, change) {
    if(owner!==this.session.pubkey)return Promise.reject(new Error('自分の公開リレーだけ変更できます'));
    return this.exclusive(10002,async (key,context)=>{
      const modern=await this.writeSource(10002,key);
      const contacts=modern?null:await this.writeSource(3,key);
      this.checkSession(context);
      const patch=changeRelayTags(relayListTags(modern,contacts),change);
      if(!patch.changed)return {event:modern,entries:relayEntries(modern,contacts),changed:false};
      const event=await this.publish({kind:10002,created_at:Math.max(nowSeconds(),(modern?.created_at??0)+1),
        tags:patch.tags,content:modern?.content??''},context);
      return {event,entries:relayEntries(event),changed:true};
    });
  }
}
