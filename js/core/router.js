import { profileKey, decodeKey } from './nip19.js?v=1.2.3';
import { isHex } from './utils.js?v=1.2.3';
const tabs=new Set(['posts','following','followers','mutes','relays']);
export const profileHref=(key,tab='posts')=>`#/profile/${key}/${tab}`;
export const threadHref=id=>`#/thread/${id}`;
export function parseRoute(hash,search='') {
  const parts=hash.replace(/^#\/?/,'').split('/');
  if(parts[0]==='profile' && isHex(parts[1]))return {view:'profile',pubkey:parts[1],tab:tabs.has(parts[2])?parts[2]:'posts'};
  if(parts[0]==='thread' && isHex(parts[1]))return {view:'thread',id:parts[1]};
  if(['global','home','notifications','settings','me'].includes(parts[0]))return {view:parts[0]};
  if(!hash){
    const q=new URLSearchParams(search);
    if(q.get('settings')==='1')return {view:'settings'};
    const key=q.get('hex')||q.get('npub');if(key)return {view:'profile',pubkey:profileKey(key),tab:'posts'};
    if(q.get('view')==='thread'){
      const raw=q.get('event')||q.get('id')||q.get('eventId')||q.get('event_id');
      if(raw){const d=decodeKey(raw);if(['hex','note','nevent'].includes(d.type))return {view:'thread',id:d.data};}
    }
    if(q.get('me')==='1'||q.get('view')==='me')return {view:'me'};
    if(['home','notifications','settings'].includes(q.get('view')))return {view:q.get('view')};
  }
  return {view:'global'};
}
export function routeHash(route){if(route.view==='profile')return profileHref(route.pubkey,route.tab);if(route.view==='thread')return threadHref(route.id);return '#/'+route.view;}
const HISTORY_KEY='mikeryanRoute';
export class Router {
  constructor(onRoute){this.onRoute=onRoute;this.route=null;this.historyDepth=0;this.historySession=null;}
  trackHistory(){
    try{
      const marker=history.state?.[HISTORY_KEY];
      if(!this.historySession && marker?.hash===location.hash && typeof marker.session==='string' && Number.isSafeInteger(marker.index) && marker.index>=0){this.historySession=marker.session;this.historyDepth=marker.index;return;}
      if(!this.historySession){this.historySession=`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
      else if(marker?.session===this.historySession && marker.hash===location.hash && Number.isSafeInteger(marker.index) && marker.index>=0){this.historyDepth=marker.index;return;}
      else this.historyDepth++;
      const state=history.state && typeof history.state==='object' && !Array.isArray(history.state)?history.state:{};
      history.replaceState({...state,[HISTORY_KEY]:{session:this.historySession,index:this.historyDepth,hash:location.hash}},'');
    }catch{/* History state may be unavailable in restricted browser contexts. */}
  }
  start(){this.trackHistory();window.addEventListener('hashchange',()=>{this.trackHistory();void this.apply();});return this.apply();}
  async apply(){try{this.route=parseRoute(location.hash,location.search);}catch{this.route={view:'global'};}return this.onRoute(this.route);}
  go(hash){if(location.hash===hash)return;location.hash=hash;}
  back(){if(this.historyDepth>0)history.back();else this.go('#/global');}
}
