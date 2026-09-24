import { el, button, field, empty, toast } from '../ui/dom.js?v=1.2.0';
import { normalizeRelay } from '../core/utils.js?v=1.2.0';

export function relayTab(app, owner, host) {
  const own=owner===app.session.pubkey, rows=el('div',{class:'public-relays'});
  const error=el('p',{class:'form-error',role:'alert',hidden:true});
  let pending=false;
  const run=async task=>{
    if(pending)return;pending=true;error.hidden=true;
    host.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);
    try { await task(); }
    catch(cause){ if(host.isConnected){error.textContent=cause.message;error.hidden=false;} }
    finally { pending=false;host.querySelectorAll('button,input,select').forEach(e=>e.disabled=false); }
  };
  const paint=entries=>{
    if(!host.isConnected)return;
    rows.replaceChildren();
    if(!entries.length)rows.append(empty('公開リレー情報がありません'));
    for(const entry of entries){
      const row=el('div',{class:'relay-row'},el('code',{},String(entry.url)),el('span',{class:'pill'},entry.mode));
      if(own&&normalizeRelay(entry.url))row.append(button('削除',()=>run(async()=>{
        const result=await app.social.changeRelay(owner,{action:'remove',url:entry.url});
        paint(result.entries);toast(result.changed?'公開リレーから削除しました':'すでに削除されています');
      }),'button secondary',{title:entry.url+' を公開リレーから削除','aria-label':entry.url+' を削除'}));
      rows.append(row);
    }
  };
  const read=button('リレーを取得',()=>run(async()=>paint(await app.social.relays(owner))),'button secondary');
  host.append(el('p',{class:'list-note'},'公開リレーリスト（NIP-65）。設定ページの接続先リレーとは別です。'),read,error,rows);
  rows.append(empty('まだ取得していません','「リレーを取得」を押してください。'));
  if(own){
    const form=el('form',{class:'public-relay-form'}),url=el('input',{type:'url',placeholder:'wss://relay.example.com/',required:true,'aria-label':'追加する公開リレー',maxLength:2048});
    const mode=el('select',{'aria-label':'公開リレーの用途'},...['read/write','read','write'].map((m,i)=>el('option',{value:m},['読み書き','読み取り','書き込み'][i])));
    form.append(field('新しい公開リレー',url),field('用途',mode),button('公開リレーに追加',null,'button primary',{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();if(!form.reportValidity()||pending)return;
      void run(async()=>{const result=await app.social.changeRelay(owner,{action:'add',url:url.value,mode:mode.value});
        paint(result.entries);url.value='';toast(result.changed?'公開リレーに追加しました':'すでに追加されています');});
    });
    host.append(form,el('p',{class:'help'},'追加・削除時は最新リストを確認して署名し、設定中のリレーへ公開します。接続先設定は変更しません。'));
  }
}
