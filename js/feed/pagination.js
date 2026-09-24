import { LIMITS } from '../core/config.js';
import { sortEvents } from '../core/utils.js';
/** Inclusive timestamp cursor + a boundary expansion: never blindly skip a full second. */
export class EventPager {
  constructor(query, baseFilters, size = 30, saved = null) {
    this.query=query; this.baseFilters=baseFilters; this.size=size;
    this.events = new Map((saved?.events ?? []).map(e => [e.id,e]));
    this.until=saved?.until ?? null; this.limit=saved?.limit ?? size; this.exhausted=saved?.exhausted ?? false;
    this.complete = true; this.busy=null; this.warning='';
  }
  snapshot() { return {events:sortEvents([...this.events.values()]),until:this.until,limit:this.limit,exhausted:this.exhausted}; }
  async older() {
    if(this.busy)return this.busy; if(this.exhausted)return [];
    this.busy=this.loadOlder().finally(()=>{this.busy=null;});return this.busy;
  }
  async loadOlder() {
    // At most one network page per click. Large same-second boundaries are expanded on the NEXT click.
    const result=await this.query(this.baseFilters.map(f=>({...f,...(this.until===null?{}:{until:this.until}),limit:this.limit})));
    this.complete=result.complete; this.warning='';
    const ordered=sortEvents(result.events), unseen=ordered.filter(e=>!this.events.has(e.id));
    const page=unseen.slice(0,this.size); for(const e of page)this.events.set(e.id,e);
    if (page.length && result.complete) {
      const last=page.at(-1).created_at;
      if(last===this.until) this.limit=Math.min(LIMITS.maxPageLimit,this.limit+this.size);
      else {this.until=last;this.limit=this.size;}
    } else if(result.complete) {
      if(!ordered.length){this.exhausted=true;}
      else {
        const boundary=ordered.at(-1).created_at;
        const saturated = ordered.length >= this.limit;
        if(saturated && this.limit < LIMITS.maxPageLimit){this.until=boundary;this.limit=Math.min(LIMITS.maxPageLimit,this.limit*2);this.warning='同じ秒の投稿が多いため、次の「さらに読み込む」で取得枠を広げます';}
        else if(saturated){this.warning='同じ秒に多数の投稿があります。リレーの上限により、この秒を完全に取得できない可能性があります';this.until=boundary-1;this.limit=this.size;}
        else {this.until=boundary-1;this.limit=this.size;}
      }
    }
    if(!result.complete)this.warning='一部のリレーから取得できませんでした。空の結果を履歴の終端とは扱いません';
    return page;
  }
  async refresh({latest=false}={}) {
    if(this.busy)return this.busy;
    this.busy=(async()=>{
      const ordered=sortEvents([...this.events.values()]), since=!latest && ordered.length ? ordered[0].created_at : null;
      const result=await this.query(this.baseFilters.map(f=>({...f,...(since===null?{}:{since}),limit:this.size})),{fresh:true});
      const page=sortEvents(result.events); for(const e of page)this.events.set(e.id,e);
      // A full delta may contain a gap. Restart the descending cursor so older() can bridge it without silently losing history.
      if(result.complete && page.length && (latest || page.length>=this.size || this.until===null)){this.until=page.at(-1).created_at;this.limit=this.size;this.exhausted=false;}
      this.complete=result.complete;
      this.warning=!latest && page.length>=this.size?'新着が多いため、さらに読み込む操作で未取得の期間を補完します':'';
      return page;
    })().finally(()=>{this.busy=null;});return this.busy;
  }
}
