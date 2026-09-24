import { APP_NAME, OUTBOX_RETENTION, storagePrefix } from '../core/config.js?v=1.1.1';
import { Emitter, isHex, nowSeconds, parseJSON, replyTags, unique } from '../core/utils.js?v=1.1.1';
const pubkeys = event => unique((event?.tags ?? []).filter(t=>t[0]==='p' && isHex(t[1])).map(t=>t[1]));
export { pubkeys };
export class Social extends Emitter {
  constructor(repository, session, settings, storage, network) {
    super(); this.repo=repository;this.session=session;this.settings=settings;this.storage=storage;this.network=network;
    this.following=new Set();this.likes=new Set();this.pending=new Set();this.writeQueue=Promise.resolve();
    this.repo.on('replace',({event})=>{if(event.pubkey===this.session.pubkey && event.kind===3){this.following=new Set(pubkeys(event));this.emit('following',this.following);}});
  }
  async loadAccount() {
    const key=this.session.pubkey;this.following=new Set();this.likes=new Set();
    if(!key)return;
    const [contacts] = await Promise.all([this.repo.replacement(3,key),this.repo.replacement(10000,key),this.repo.profile(key)]);
    if(this.session.pubkey!==key)return;
    this.following=new Set(pubkeys(contacts));this.likes=new Set();this.emit('following',this.following);
  }
  async publish(template) {
    const event=await this.session.sign({...template,tags:[...(template.tags??[]).filter(t=>t[0]!=='client'),['client',APP_NAME]]});
    return this.sendSigned(event);
  }
  async sendSigned(event, relays = this.settings.value.relays, acceptedResults = []) {
    let result=await this.network.publish({event,relays,gap:this.settings.value.requestGapMs});
    if (acceptedResults.length) { const results=[...acceptedResults,...result.results]; result={results,accepted:results.filter(r=>r.accepted).length,total:results.length}; }
    const outbox=await this.storage.get(`outbox:${event.pubkey}`)??[];
    const remaining=outbox.filter(x=>x.event.id!==event.id);
    if(result.accepted<result.total) remaining.push({event,results:result.results,time:Date.now()});
    await this.storage.set(`outbox:${event.pubkey}`,remaining.slice(-30),OUTBOX_RETENTION);
    this.emit('delivery',result);
    if(!result.accepted)throw new Error('どのリレーにも受理されませんでした。署名済みイベントを設定の「未完了の送信」に保存しました。新しく投稿し直す前に、そちらから再送してください');
    await this.repo.published(event);
    if(result.accepted<result.total)this.emit('notice',`${result.accepted}/${result.total}リレーに保存しました。未達分は設定画面から再送できます`);
    return event;
  }
  async retry(event) {
    if(event.pubkey!==this.session.pubkey)throw new Error('別アカウントの送信は再実行できません');
    const item=(await this.storage.get(`outbox:${event.pubkey}`)??[]).find(item=>item.event.id===event.id);
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
    const id=event.id;if(this.likes.has(id)||this.pending.has(`like:${id}`))return;
    this.pending.add(`like:${id}`);
    try{
      const signed=await this.publish({kind:7,content:'+',tags:[['e',event.id],['p',event.pubkey],['k',String(event.kind)]]});
      this.likes.add(id);this.emit('like',id);
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
  exclusive(kind,task) {
    const pubkey=this.session.pubkey;if(!pubkey)return Promise.reject(new Error('ログインしてください'));
    const run=this.writeQueue.then(async()=>{
      if(this.session.pubkey!==pubkey)throw new Error('アカウントが変更されました');
      const locked=()=>task(pubkey);
      return navigator.locks ? navigator.locks.request(`${storagePrefix()}write:${pubkey}:${kind}`,locked) : locked();
    });this.writeQueue=run.catch(()=>{});return run;
  }
  async toggleFollow(target) {
    if(!isHex(target)||target===this.session.pubkey)throw new Error('フォロー対象が不正です');
    if(this.pending.has(`follow:${target}`))return;this.pending.add(`follow:${target}`);this.emit('followBusy',target);
    try{return await this.exclusive(3,async key=>{
      const current=await this.repo.replacement(3,key,{fresh:true,all:true,required:true});
      const exists=pubkeys(current).includes(target);
      const tags=(current?.tags??[]).filter(t=>!(t[0]==='p'&&t[1]===target));if(!exists)tags.push(['p',target]);
      const event=await this.publish({kind:3,created_at:Math.max(nowSeconds(),(current?.created_at??0)+1),tags,content:current?.content??''});
      this.following=new Set(pubkeys(event));this.emit('following',this.following);return !exists;
    });}finally{this.pending.delete(`follow:${target}`);this.emit('followBusy',target);}
  }
  editProfile(fields) {
    return this.exclusive(0,async key=>{
      const current=await this.repo.replacement(0,key,{fresh:true,all:true,required:true});
      const profile=parseJSON(current?.content,{})??{};
      if(typeof profile!=='object'||Array.isArray(profile))throw new Error('既存プロフィールのJSONが不正です');
      for(const k of ['name','display_name','about','picture','banner','nip05','website','lud16']){
        if(fields[k]===undefined)continue;const value=String(fields[k]).trim();if(value)profile[k]=value;else delete profile[k];
      }
      return this.publish({kind:0,created_at:Math.max(nowSeconds(),(current?.created_at??0)+1),content:JSON.stringify(profile),tags:current?.tags??[]});
    });
  }
  async list(kind,owner) { return pubkeys(await this.repo.replacement(kind,owner)); }
  async followingBack(owner,candidates) {
    const contacts=await Promise.all(candidates.map(k=>this.repo.replacement(3,k)));
    return new Set(candidates.filter((k,i)=>pubkeys(contacts[i]).includes(owner)));
  }
  async relays(owner) {
    const modern=await this.repo.replacement(10002,owner);
    if(modern)return modern.tags.filter(t=>t[0]==='r').map(t=>({url:t[1],mode:t[2]??'read/write'}));
    const contact=await this.repo.replacement(3,owner), old=parseJSON(contact?.content,{});
    if(Array.isArray(old))return old.map(url=>({url,mode:'legacy'}));
    return Object.entries(old??{}).map(([url,flags])=>({url,mode:[flags?.read!==false?'read':'',flags?.write!==false?'write':''].filter(Boolean).join('/')}));
  }
}
