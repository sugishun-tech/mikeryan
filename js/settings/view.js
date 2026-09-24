import { DEFAULTS } from '../core/config.js?v=1.1.1';
import { el, button, busy, field, toast, empty } from '../ui/dom.js?v=1.1.1';
import { lines, normalizeRelay } from '../core/utils.js?v=1.1.1';
import { local } from '../core/storage.js?v=1.1.1';
export async function settingsView(app,host){
  const s=app.settings.value,form=el('form',{class:'settings-form'}),inputs={};
  const add=(key,label,tag='input',attrs={})=>{const input=el(tag,{...attrs,value:Array.isArray(s[key])?s[key].join('\n'):s[key]});inputs[key]=input;form.append(field(label,input));return input;};
  form.append(el('h2',{},'アカウント'));
  const account=el('p',{class:'muted-text'},app.session.pubkey?'公開鍵を保存済みです。秘密鍵は拡張機能だけが管理します。':'ログインしていません。');form.append(account);
  const login=button(app.session.pubkey?'アカウントを切り替える':'NIP-07でログイン',()=>busy(login,()=>app.login()),'button secondary');form.append(el('div',{class:'setting-actions'},login,app.session.pubkey?button('ログアウト',()=>{app.session.logout();app.router.go('#/global');},'button secondary'):null));
  form.append(el('h2',{},'リレー・通信'));
  add('relays','リレー（1行に1つ・上から読み取りに使用）','textarea',{rows:5,spellcheck:false,required:true});
  form.append(el('p',{class:'help'},'読み取りは指定した台数だけ、書き込みは全リレーへ1回ずつ送信します。未使用タブの取得・定期ポーリング・無制限の再接続は行いません。リレーの利用条件による拒否は防げません。'));
  add('readRelayCount','読み取りリレー数','input',{type:'number',min:1,max:12});
  add('requestGapMs','同じリレーへの要求間隔（ミリ秒）','input',{type:'number',min:800,max:10000,step:100});
  form.append(el('p',{class:'help'},'投稿の読み込みは1回につき最大30件です。'));
  form.append(el('h2',{},'表示・ミュート'));
  const select=el('select',{},...Object.entries({light:'ライト',dark:'ダーク',auto:'システム設定'}).map(([value,label])=>el('option',{value,selected:s.theme===value},label)));inputs.theme=select;form.append(field('テーマ',select));
  for(const [key,label]of Object.entries({loadImages:'プロフィール画像を読み込む',verifyNip05:'NIP-05を検証して認証マークを表示',hideIncompleteProfiles:'name / display_name が揃わない投稿者を非表示にする'})){
    const input=el('input',{type:'checkbox',checked:s[key]});inputs[key]=input;form.append(el('label',{class:'checkbox-field'},input,label));
  }
  form.append(el('p',{class:'help'},'初期値は添付mynostrのミュート条件を引き継ぎます。URL・nostr:・#・かなを含まない投稿が非表示になります。NIP-05のマークは識別子と公開鍵の一致であり、実在の本人や発言内容の保証ではありません。'));
  add('muteDisplayNamePatterns','名前のミュート正規表現（1行に1つ）','textarea',{rows:3,spellcheck:false});
  add('muteContentPatterns','本文のミュート正規表現（1行に1つ）','textarea',{rows:4,spellcheck:false});
  add('mutedPubkeys','ミュート公開鍵hex（1行に1つ）','textarea',{rows:3,spellcheck:false});
  form.append(button('表示フィルターをすべて解除',()=>{inputs.muteDisplayNamePatterns.value='';inputs.muteContentPatterns.value='';inputs.mutedPubkeys.value='';inputs.hideIncompleteProfiles.checked=false;toast('フォームに反映しました。保存すると有効になります');},'text-button'));
  const read=()=>Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.type==='checkbox'?input.checked:['relays','muteDisplayNamePatterns','muteContentPatterns','mutedPubkeys'].includes(key)?lines(input.value):['readRelayCount','requestGapMs','batchSize'].includes(key)?Number(input.value):input.value]));
  const save=button('設定を保存',()=>busy(save,async()=>{app.settings.save(read());toast('設定を保存しました');app.applyTheme();}),'button primary');
  const exportButton=button('JSONエクスポート',()=>{
    const blob=new Blob([JSON.stringify(read(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a',{href:url,download:'mikeryan-settings.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'button secondary');
  const importInput=el('input',{type:'file',accept:'.json,application/json',hidden:true});
  importInput.addEventListener('change',async()=>{try{const file=importInput.files?.[0];if(!file)return;if(file.size>262144)throw new Error('設定ファイルが大きすぎます');app.settings.save(JSON.parse(await file.text()));toast('設定をインポートしました');await app.render(app.router.route);}catch(e){toast(e.message,true);}});
  form.append(el('div',{class:'setting-actions'},save,exportButton,button('JSONインポート',()=>importInput.click(),'button secondary'),importInput));
  form.append(button('初期設定に戻す',()=>{if(confirm('リレーと表示設定を初期値へ戻しますか？')){app.settings.reset();void app.render(app.router.route);}},'text-button'));
  form.addEventListener('submit',e=>e.preventDefault());host.append(form);
  const diagnostics=el('section',{class:'settings-section'},el('h2',{},'リレー接続・エラー'));
  const output=el('div',{});const inspect=async()=>{const stats=await app.network.stats();if(!output.isConnected)return;output.replaceChildren(el('p',{class:'help'},`${stats.mode==='shared-worker'?'タブ間でリレー接続を共有':'このブラウザーではタブごとの接続'} · 同時要求の統合 ${stats.coalesced}回`));
    for(const r of stats.relays){const row=el('div',{class:'relay-status'},el('strong',{},r.relay),el('p',{},`${r.connected?'接続中':'未接続'} · REQ ${r.requests} · CLOSE ${r.closes} · EVENT送信 ${r.publishes} · 受信 ${Math.ceil(r.receivedBytes/1024)} KiB`));if(r.reason)row.append(el('p',{class:'warning'},r.reason+(r.until>Date.now()?` · ${new Date(r.until).toLocaleTimeString()}まで休止`:'')));
      if(r.authRequired){const auth=button('このリレーを認証',()=>busy(auth,async()=>{const info=await app.network.authInfo({relay:r.relay});if(!info.challenge)throw new Error('認証チャレンジがまだ届いていません');if(!confirm(`${r.relay} に公開鍵を提示して認証しますか？`))return;const event=await app.session.sign({kind:22242,tags:[['relay',r.relay],['challenge',info.challenge]],content:''});await app.network.authenticate({relay:r.relay,event});toast('リレー認証を完了しました');await inspect();}),'button secondary');row.append(auth);}output.append(row);}
  };
  const refresh=button('状況を更新',()=>busy(refresh,inspect),'button secondary');diagnostics.append(refresh,output);host.append(diagnostics);await inspect();
  if(!host.isConnected)return;
  const outbox=el('section',{class:'settings-section'},el('h2',{},'未完了の送信'));host.append(outbox);
  if(app.session.pubkey){const rows=await app.storage.get(`outbox:${app.session.pubkey}`)??[];if(!rows.length)outbox.append(el('p',{class:'help'},'未完了の送信はありません。'));
    for(const item of rows){const row=el('div',{class:'outbox-item'},el('p',{},`kind:${item.event.kind} · ${new Date(item.time).toLocaleString()}`),el('p',{},item.event.content.slice(0,180)),el('p',{class:'help'},item.results.filter(r=>!r.accepted).map(r=>r.relay+': '+r.reason).join('\n')));
      const retry=button('未達リレーへ再送',()=>busy(retry,async()=>{await app.social.retry(item.event);toast('再送結果を更新しました');await app.render(app.router.route);}),'button secondary');row.append(retry);outbox.append(row);}
  }else outbox.append(el('p',{class:'help'},'ログインすると表示できます。'));
}
