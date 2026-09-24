import { safeURL } from '../core/utils.js';
import { FALLBACK_ICON } from '../core/config.js';
export function el(tag,attributes={},...children){
  const node=document.createElement(tag);
  for(const [key,value]of Object.entries(attributes)){
    if(value===null||value===undefined)continue;
    if(key==='class')node.className=value;
    else if(key==='text')node.textContent=value;
    else if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2),value);
    else if(key==='dataset')Object.assign(node.dataset,value);
    else if(key in node && !key.startsWith('aria'))node[key]=value;
    else node.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined&&child!==false)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
export const button=(text,handler,cls='button secondary',attrs={})=>el('button',{type:'button',class:cls,onclick:handler,...attrs},text);
const icons={
  home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 22v-3a8 8 0 0 1 16 0v3',
  settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  reply:'M21 11a9 8 0 0 1-9 8H6l-4 3 1-7a8 8 0 0 1 9-12 9 8 0 0 1 9 8Z',
  heart:'M12 21 3 12C-2 4 8-1 12 6c4-7 14-2 9 6Z',
  share:'M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8',
  search:'M19 19l-5-5M16 9A7 7 0 1 1 2 9a7 7 0 0 1 14 0Z',
  back:'M20 12H4m7-7-7 7 7 7',
  check:'m5 12 4 4L19 6',
  refresh:'M20 8a8 8 0 1 0 0 8M20 3v5h-5',
  write:'m14 4 6 6M4 20l5-1L21 7l-4-4L5 15Z',
  link:'m9 15 6-6M8 8l-3 3a4 4 0 0 0 6 6l3-3M10 10l3-3a4 4 0 0 1 6 6l-3 3',
  close:'m6 6 12 12M6 18 18 6',
  logout:'M9 4H3v16h6m6-16 6 8-6 8M7 12h14'
};
export function icon(name,size=24){const node=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v]of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))node.setAttribute(k,v);const path=document.createElementNS(node.namespaceURI,'path');path.setAttribute('d',icons[name]??icons.link);node.append(path);return node;}
export function avatar(profile={},className='avatar',images=true){const source=images?safeURL(profile.picture,{image:true}):'';const image=el('img',{class:className,src:source||FALLBACK_ICON,alt:'',loading:'lazy',decoding:'async',referrerPolicy:'no-referrer'});image.addEventListener('error',()=>{if(image.src!==FALLBACK_ICON)image.src=FALLBACK_ICON;});return image;}
export function richText(text){
  const out=document.createDocumentFragment(),regex=/(https?:\/\/[^\s<>]+|nostr:(?:npub|nprofile|note|nevent)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi;let offset=0;
  for(const m of String(text).matchAll(regex)){out.append(document.createTextNode(text.slice(offset,m.index)));const href=safeURL(m[0]);if(href)out.append(el('a',{href,target:'_blank',rel:'noopener noreferrer nofollow',referrerPolicy:'no-referrer'},m[0]));else out.append(document.createTextNode(m[0]));offset=m.index+m[0].length;}out.append(document.createTextNode(String(text).slice(offset)));return out;
}
export function toast(message,error=false){const region=document.getElementById('toasts');const node=el('div',{class:`toast${error?' error':''}`,role:error?'alert':'status'},message);region?.append(node);setTimeout(()=>node.remove(),error?12000:6000);}
export async function busy(button,fn){if(button.disabled)return;button.disabled=true;button.setAttribute('aria-busy','true');try{return await fn();}catch(e){toast(e.message,true);return null;}finally{button.disabled=false;button.removeAttribute('aria-busy');}}
export const empty=(title,detail='')=>el('div',{class:'empty-state'},el('h2',{},title),detail?el('p',{},detail):null);
export const loading=()=>el('div',{class:'loading',role:'status'},el('span',{class:'spinner'}),'読み込み中…');
export async function copy(text){try{await navigator.clipboard.writeText(text);toast('コピーしました');}catch{toast('クリップボードを利用できません',true);}}
export function field(label,input){input.setAttribute('aria-label',label);return el('label',{class:'field'},el('span',{},label),input);}
